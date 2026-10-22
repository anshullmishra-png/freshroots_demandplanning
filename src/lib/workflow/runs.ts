import { eq } from "drizzle-orm";
import { aiDecisions, dataSnapshots, flags, runs } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import type { GeminiClient } from "@/lib/ai/client";
import { generateDecisions } from "@/lib/ai/decide";
import type { PromptBundle } from "@/lib/ai/prompts";
import type { RulesConfig } from "@/lib/config/rules";
import { notFound, badRequest } from "@/lib/errors";
import { runRuleEngine } from "@/lib/rules/engine";
import type { RunResult } from "@/lib/rules/types";
import { validateUpload } from "@/lib/validation/validate";
import type { FileKey, ValidatedData } from "@/lib/validation/types";
import { assertAutomationRunning, killStateLabel } from "@/lib/kill/service";
import { writeAudit } from "./audit";

/**
 * Rebuilds the cleaned data for a stored snapshot from its raw files, so a run is reproducible from what was
 * uploaded (guardrail G-D5). Freshness was already enforced when the files were uploaded (a snapshot cannot be
 * stored otherwise), so it is judged here as of the data's own date, never against today's clock.
 */
export async function loadSnapshotData(
  db: AnyDb,
  snapshotId: number,
  rules: RulesConfig,
): Promise<{ data: ValidatedData; uploadedAt: Date }> {
  const [snap] = await db.select().from(dataSnapshots).where(eq(dataSnapshots.id, snapshotId)).limit(1);
  if (!snap) throw notFound(`Data snapshot ${snapshotId} does not exist.`);
  const result = validateUpload(snap.rawFilesJson as Partial<Record<FileKey, string>>, {
    rules,
    now: new Date(`${snap.asOfDate}T12:00:00+05:30`),
  });
  if (!result.ok || !result.data) {
    throw badRequest("SNAPSHOT_INVALID", "The stored snapshot no longer passes validation.", result.errors);
  }
  return { data: result.data, uploadedAt: snap.uploadedAt };
}

export interface CreatedRun {
  runId: number;
  flagCount: number;
  fallbackCount: number;
  fallbackWarning: boolean;
  status: "in_review" | "completed";
}

/**
 * Steps 4 and 5 of the flow: rule engine, then the AI decision for every flag. Everything is stored with
 * the rules used, so the run can be reproduced (G-R3). Flags come only from the rule engine (G-A1).
 */
export async function createRun(
  db: AnyDb,
  args: {
    snapshotId: number;
    createdBy: number | null;
    rules: RulesConfig;
    client: GeminiClient;
    model: string;
    prompts: PromptBundle;
  },
): Promise<CreatedRun> {
  const { snapshotId, createdBy, rules, client, model, prompts } = args;
  await assertAutomationRunning(db); // the AI step never runs while a kill is active (G-K2)
  const killStateAtRun = await killStateLabel(db);
  const { data } = await loadSnapshotData(db, snapshotId, rules);
  const result: RunResult = runRuleEngine(data, rules);

  // 1. Store the run and its flags.
  const { runId, flagIds } = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({
        snapshotId,
        createdBy,
        rulesVersion: rules.version,
        rulesJson: rules,
        status: "flagged",
        killStateAtRun,
        summaryJson: {
          as_of_date: result.as_of_date,
          last_complete_week: result.last_complete_week,
          is_festival: result.is_festival,
          uplift: result.uplift,
          unflagged: result.unflagged,
          skipped: result.skipped,
        },
      })
      .returning({ id: runs.id });

    const ids = new Map<string, number>();
    if (result.flags.length > 0) {
      const inserted = await tx
        .insert(flags)
        .values(
          result.flags.map((f) => ({
            runId: run.id,
            skuId: f.sku_id,
            flagTypes: f.flag_types,
            avgWeeklySales: f.avg_weekly_sales,
            recentAvg: f.recent_avg,
            demandRatio: f.demand_ratio,
            uplift: f.uplift,
            demandRate: f.demand_rate,
            unitsOnHand: f.units_on_hand,
            coverWeeks: f.cover_weeks,
            minCover: f.min_cover,
            maxCover: f.max_cover,
            standardQty: f.standard_qty,
            multiplier: f.multiplier,
            ruleAction: f.rule_action,
            ruleQty: f.rule_qty,
            needsJudgment: f.needs_judgment,
            judgmentReasons: f.judgment_reasons,
          })),
        )
        .returning({ id: flags.id, skuId: flags.skuId });
      for (const row of inserted) ids.set(row.skuId, row.id);
    }
    await writeAudit(tx, {
      actorId: createdBy,
      action: "run.created",
      entity: "run",
      entityId: run.id,
      after: { snapshotId, rules_version: rules.version, flags: result.flags.length, skipped: result.skipped.length },
    });
    return { runId: run.id, flagIds: ids };
  });

  // 2. The AI step. It never throws on AI failure: a failed flag becomes a marked fallback.
  const batch = await generateDecisions({ client, run: result, skus: data.skus, rules, model, prompts });

  // 3. Store the decisions and open the run for review.
  const status = batch.decisions.length > 0 ? "in_review" : "completed";
  await db.transaction(async (tx) => {
    if (batch.decisions.length > 0) {
      await tx.insert(aiDecisions).values(
        batch.decisions.map((d) => ({
          flagId: flagIds.get(d.sku_id)!,
          model: d.model,
          promptVersion: d.prompt_version,
          action: d.action,
          quantity: d.quantity,
          explanation: d.explanation,
          confidence: d.confidence,
          needsJudgment: d.needs_judgment,
          judgmentNote: d.judgment_note,
          valid: d.valid,
          invalidReasons: d.invalid_reasons,
          isFallback: d.is_fallback,
          inputJson: d.input_json,
          rawResponseJson: d.raw_response_json,
          attemptsJson: d.attempts,
          latencyMs: d.latency_ms,
        })),
      );
    }
    await tx.update(runs).set({ status, fallbackWarning: batch.fallback_warning }).where(eq(runs.id, runId));
    await writeAudit(tx, {
      actorId: createdBy,
      action: "run.ai_done",
      entity: "run",
      entityId: runId,
      after: { decisions: batch.decisions.length, fallbacks: batch.fallback_count, fallback_warning: batch.fallback_warning },
    });
  });

  return {
    runId,
    flagCount: result.flags.length,
    fallbackCount: batch.fallback_count,
    fallbackWarning: batch.fallback_warning,
    status,
  };
}
