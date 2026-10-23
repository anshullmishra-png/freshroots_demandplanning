import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { aiDecisions, dataSnapshots, flags, runs } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import type { GeminiClient } from "@/lib/ai/client";
import { generateDecisions } from "@/lib/ai/decide";
import type { PromptBundle } from "@/lib/ai/prompts";
import type { RulesConfig } from "@/lib/config/rules";
import { badRequest, notFound } from "@/lib/errors";
import { assertAutomationRunning, killStateLabel } from "@/lib/kill/service";
import { runRuleEngine } from "@/lib/rules/engine";
import type { FlagRecord, FlagType, RunResult } from "@/lib/rules/types";
import { validateUpload } from "@/lib/validation/validate";
import type { FileKey, ValidatedData } from "@/lib/validation/types";
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
  /** "flagged" while AI decisions are still being prepared; `remaining` says how many flags still need one. */
  status: "flagged" | "in_review" | "completed" | "blocked";
  remaining: number;
}

/**
 * Steps 4 and 5 of the flow. First the rule engine: the run and its flags are stored at once, with the rules used, so
 * the run can be reproduced (G-R3). Flags come only from the rule engine (G-A1). Then the AI decisions are made in
 * small batches within a time budget; if the budget runs out the run stays "flagged" and `decideRun` finishes it.
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
    budgetMs?: number;
  },
): Promise<CreatedRun> {
  const { snapshotId, createdBy, rules } = args;
  await assertAutomationRunning(db); // the AI step never runs while a kill is active (G-K2)
  const killStateAtRun = await killStateLabel(db);
  const { data } = await loadSnapshotData(db, snapshotId, rules);
  const result: RunResult = runRuleEngine(data, rules);

  const runId = await db.transaction(async (tx) => {
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

    if (result.flags.length > 0) {
      await tx.insert(flags).values(
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
      );
    }
    await writeAudit(tx, {
      actorId: createdBy,
      action: "run.created",
      entity: "run",
      entityId: run.id,
      after: { snapshotId, rules_version: rules.version, flags: result.flags.length, skipped: result.skipped.length },
    });
    return run.id;
  });

  return decideRun(db, { runId, rules, client: args.client, model: args.model, prompts: args.prompts, budgetMs: args.budgetMs, data });
}

/** A stored flag row back into the shape the AI input builder wants. */
function toFlagRecord(f: typeof flags.$inferSelect): FlagRecord {
  return {
    sku_id: f.skuId,
    flag_types: f.flagTypes as FlagType[],
    avg_weekly_sales: f.avgWeeklySales,
    recent_avg: f.recentAvg,
    demand_ratio: f.demandRatio,
    uplift: f.uplift,
    demand_rate: f.demandRate,
    units_on_hand: f.unitsOnHand,
    cover_weeks: f.coverWeeks,
    min_cover: f.minCover,
    max_cover: f.maxCover,
    standard_qty: f.standardQty,
    multiplier: f.multiplier,
    rule_action: f.ruleAction,
    rule_qty: f.ruleQty,
    needs_judgment: f.needsJudgment,
    judgment_reasons: f.judgmentReasons,
  };
}

/**
 * Makes the AI decision for every flag of a run that does not have one yet, a batch at a time, saving each batch as it
 * goes. It stops when the time budget is used up and says how many are left; calling it again carries on. Safe to call
 * twice at once (a flag has at most one decision) and safe after a closed browser tab. Refuses while a kill is active.
 */
export async function decideRun(
  db: AnyDb,
  args: {
    runId: number;
    rules: RulesConfig;
    client: GeminiClient;
    model: string;
    prompts: PromptBundle;
    budgetMs?: number;
    data?: ValidatedData;
  },
): Promise<CreatedRun> {
  const { runId, rules, client, model, prompts } = args;
  // How long one request may spend on AI calls before it saves its progress and hands back (Vercel allows 300 s).
  const budgetMs = args.budgetMs ?? rules.ai.step_budget_seconds * 1000;
  const started = Date.now();

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound(`Run ${runId} does not exist.`);
  if (run.status !== "flagged") return summarise(db, runId, rules);
  await assertAutomationRunning(db);

  const flagRows = await db.select().from(flags).where(eq(flags.runId, runId)).orderBy(asc(flags.id));
  const waiting = await db
    .select({ id: flags.id })
    .from(flags)
    .leftJoin(aiDecisions, eq(aiDecisions.flagId, flags.id))
    .where(and(eq(flags.runId, runId), isNull(aiDecisions.id)))
    .orderBy(asc(flags.id));
  const waitingIds = new Set(waiting.map((w) => w.id));
  const todo = flagRows.filter((f) => waitingIds.has(f.id));

  if (todo.length > 0) {
    const data = args.data ?? (await loadSnapshotData(db, run.snapshotId, rules)).data;
    const summary = run.summaryJson as { as_of_date: string; is_festival: boolean };
    const flagIdBySku = new Map(flagRows.map((f) => [f.skuId, f.id]));
    const batchSize = Math.max(1, rules.ai.concurrency);
    for (let i = 0; i < todo.length; i += batchSize) {
      // Out of time: save what is done and hand back. A budget of 0 means "decide nothing now". Any other budget always
      // allows the first batch, however long the set-up took (a slow database link once left a request with no time at
      // all, so every request made no progress and the run never finished).
      if (budgetMs === 0 || (i > 0 && Date.now() - started >= budgetMs)) break;
      const batch = await generateDecisions({
        client,
        run: { as_of_date: summary.as_of_date, is_festival: summary.is_festival, flags: todo.slice(i, i + batchSize).map(toFlagRecord) },
        skus: data.skus,
        rules,
        model,
        prompts,
      });
      await db
        .insert(aiDecisions)
        .values(
          batch.decisions.map((d) => ({
            flagId: flagIdBySku.get(d.sku_id)!,
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
        )
        .onConflictDoNothing();
    }
  }

  const state = await summarise(db, runId, rules);
  if (state.remaining > 0) return state;

  // Every flag has a decision. Exactly one caller wins the right to open the run for review.
  const opened = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(runs)
      .set({ status: "in_review", fallbackWarning: state.fallbackWarning })
      .where(and(eq(runs.id, runId), eq(runs.status, "flagged")))
      .returning({ id: runs.id });
    if (claimed.length === 0) return false;
    await writeAudit(tx, {
      actorId: run.createdBy,
      action: "run.ai_done",
      entity: "run",
      entityId: runId,
      after: { decisions: state.flagCount, fallbacks: state.fallbackCount, fallback_warning: state.fallbackWarning },
    });
    return true;
  });
  if (opened) {
    const [{ n: pending }] = await db
      .select({ n: count() })
      .from(aiDecisions)
      .innerJoin(flags, eq(flags.id, aiDecisions.flagId))
      .where(and(eq(flags.runId, runId), eq(aiDecisions.status, "pending_review")));
    // Nothing to review (no flags, or everything was reviewed while the last decisions were being made): done.
    if (pending === 0) await db.update(runs).set({ status: "completed" }).where(and(eq(runs.id, runId), eq(runs.status, "in_review")));
  }
  return summarise(db, runId, rules);
}

/** Where a run stands: how many flags, how many still need a decision, how many fell back to the rule engine. */
async function summarise(db: AnyDb, runId: number, rules: RulesConfig): Promise<CreatedRun> {
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
  const [row] = await db
    .select({
      flagCount: count(),
      withDecision: sql<number>`count(${aiDecisions.id})`.mapWith(Number),
      fallbacks: sql<number>`count(*) filter (where ${aiDecisions.isFallback})`.mapWith(Number),
    })
    .from(flags)
    .leftJoin(aiDecisions, eq(aiDecisions.flagId, flags.id))
    .where(eq(flags.runId, runId));
  const ratePct = row.withDecision === 0 ? 0 : (row.fallbacks / row.withDecision) * 100;
  return {
    runId,
    flagCount: row.flagCount,
    fallbackCount: row.fallbacks,
    fallbackWarning: ratePct > rules.ai.fallback_warning_pct, // "more than 30%": strictly above
    status: run.status === "created" ? "flagged" : (run.status as CreatedRun["status"]),
    remaining: row.flagCount - row.withDecision,
  };
}
