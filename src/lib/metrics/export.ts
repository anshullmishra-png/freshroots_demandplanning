import type { AnyDb } from "@/db/snapshots";
import { assertCan } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { istDate } from "@/lib/dates/isoWeek";
import { badRequest } from "@/lib/errors";
import { toCsv } from "@/lib/orders/csv";
import { writeAudit } from "@/lib/workflow/audit";
import { getDashboard } from "./queries";

export const METRIC_EXPORTS = ["summary", "runs", "losses"] as const;
export type MetricExport = (typeof METRIC_EXPORTS)[number];

/** Priya's metrics CSV. Cells go through the same formula-injection-safe writer as the orders export (G-S7). */
export async function exportMetrics(db: AnyDb, actor: SessionUser, kind: string | null, now = new Date()): Promise<{ filename: string; content: string }> {
  assertCan(actor.role, "export_metrics");
  const which = (kind ?? "summary") as MetricExport;
  if (!METRIC_EXPORTS.includes(which)) throw badRequest("BAD_KIND", `kind must be one of: ${METRIC_EXPORTS.join(", ")}.`);
  const d = await getDashboard(db, { now });
  const k = d.kill;

  let rows: Array<Array<string | number | null>>;
  if (which === "summary") {
    rows = [
      ["metric", "value", "unit", "note"],
      ["quarter", k.kill2.loss.quarter.label, "", ""],
      ["quarter_to_date_loss", k.kill2.loss.total, "rupees", `alert above ${k.kill2.alertAbove}, kill above ${k.kill2.killAbove}`],
      ["stockout_loss", k.kill2.loss.stockout, "rupees", ""],
      ["overstock_writeoff", k.kill2.loss.overstock, "rupees", ""],
      ["kill2_state", k.kill2.state, "", ""],
      ["kill1_state", k.kill1.state, "", ""],
      ["reviewed_ai_decisions", k.kill1.result.reviewed, "decisions", "non-fallback, since the last re-arm"],
      ["reversed_ai_decisions", k.kill1.result.reversed, "decisions", ""],
      ["reversal_rate", k.kill1.result.ratePct === null ? null : Math.round(k.kill1.result.ratePct * 100) / 100, "percent", `kill at ${k.kill1.result.thresholdPct}% once ${k.kill1.result.minReviewed} reviewed`],
      ["ai_fallback_rate", d.quality.fallbackRatePct === null ? null : Math.round(d.quality.fallbackRatePct * 100) / 100, "percent", ""],
      ["needs_judgment_share", d.quality.needsJudgmentSharePct === null ? null : Math.round(d.quality.needsJudgmentSharePct * 100) / 100, "percent", ""],
      ["avg_data_age_at_placing", d.workflow.avgDataAgeDays, "days", "baseline 21 to 28"],
      ["avg_order_lag", d.workflow.avgOrderLagHours, "hours", ""],
      ["runs_this_month", d.workflow.runsThisMonth, "runs", "baseline 1"],
      ...d.reasons.map((r) => [`rejections_${r.code}`, r.count, "decisions", ""] as Array<string | number | null>),
    ];
  } else if (which === "runs") {
    rows = [
      ["run_id", "date", "status", "data_as_of", "flags", "high_demand", "stockout_risk", "overstock_risk", "accepted", "rejected", "ai_fallback", "review_turnaround_hours"],
      ...d.runs.map((r) => [r.runId, r.date, r.status, r.asOfDate, r.flags, r.high, r.stockout, r.overstock, r.accepted, r.rejected, r.fallback, r.turnaroundHours]),
    ];
  } else {
    rows = [
      ["entry_id", "period_start", "period_end", "stockout_loss_rupees", "overstock_writeoff_rupees", "total_rupees", "note"],
      ...d.losses.map((l) => [l.id, l.periodStart, l.periodEnd, l.stockout, l.overstock, l.total, l.note]),
    ];
  }
  await writeAudit(db, { actorId: actor.id, action: "metrics.exported", entity: "metrics", entityId: which, after: { rows: rows.length - 1 } });
  return { filename: `freshroots-metrics-${which}-${istDate(now)}.csv`, content: toCsv(rows) };
}
