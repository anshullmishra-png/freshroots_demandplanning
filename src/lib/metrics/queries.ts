import { asc, gte, sql } from "drizzle-orm";
import { lossEntries } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { istDate } from "@/lib/dates/isoWeek";
import { getKillStatus, type KillStatus } from "@/lib/kill/service";
import { quarterOf } from "@/lib/kill/logic";

// Fixed definitions from docs/09-MEASUREMENT-PLAN.md (guardrail G-M3). The dashboard shows these and never redefines them.
export const METRIC_DEFINITIONS = {
  quarterLoss: "Sum of stockout lost sales and overstock write-offs over Priya's loss entries in the current calendar quarter. Baseline: Rs 28 to 34 lakh per quarter (stockout Rs 18 to 22 lakh, overstock Rs 10 to 12 lakh).",
  reversalRate: "Reversed reviewed AI decisions divided by reviewed AI decisions: non-fallback, cumulative since the last re-arm. Kill 1 fires at 10% or more once 30 are reviewed.",
  dataAge: "Days from the as-of date of the SAP data to the day procurement placed the order. Baseline before this system: 21 to 28 days.",
  orderLag: "Hours from Raghav's review being saved to procurement marking the order placed. Not measured before.",
  runsPerMonth: "Completed runs in the current month. Baseline: 1 (the monthly process).",
  turnaround: "Hours from a run being created to its last review being saved. Not measured before.",
  fallbackRate: "AI fallback decisions divided by all decisions. A warning shows above 30% in a run.",
  needsJudgment: "Decisions marked needs-judgment divided by all decisions: a proxy for the 15 to 20% the rules do not cover.",
  reasons: "Count of rejections per reason code. The weekly input for improving the rules and the prompt.",
} as const;

export interface LossBar {
  id: number;
  periodStart: string;
  periodEnd: string;
  stockout: number;
  overstock: number;
  total: number;
  note: string | null;
}
export interface TrendPoint {
  day: string;
  reviewed: number;
  reversed: number;
  ratePct: number;
}
export interface RunRow {
  runId: number;
  date: string;
  status: string;
  asOfDate: string;
  flags: number;
  high: number;
  stockout: number;
  overstock: number;
  accepted: number;
  rejected: number;
  fallback: number;
  turnaroundHours: number | null;
}
export interface DashboardData {
  kill: KillStatus;
  losses: LossBar[];
  baseline: RulesConfig["baseline_per_quarter_rupees"];
  trend: TrendPoint[];
  reasons: Array<{ code: string; count: number }>;
  runs: RunRow[];
  quality: { decisions: number; fallbackRatePct: number | null; needsJudgmentSharePct: number | null };
  workflow: { placedOrders: number; avgDataAgeDays: number | null; avgOrderLagHours: number | null; runsThisMonth: number };
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

async function rows(db: AnyDb, query: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(query)) as unknown as { rows: Row[] };
  return res.rows;
}

/** Everything the dashboard shows, from the tables in docs/03-DATA-SPEC.md. Outcomes in the world first (G-M1). */
export async function getDashboard(db: AnyDb, opts: { rules?: RulesConfig; now?: Date } = {}): Promise<DashboardData> {
  const rules = opts.rules ?? loadRules();
  const now = opts.now ?? new Date();
  const today = istDate(now);
  const kill = await getKillStatus(db, { rules, now });
  const quarter = quarterOf(today, rules.kill_switch_2.quarter_start_month);

  const losses = (
    await db
      .select()
      .from(lossEntries)
      .where(gte(lossEntries.periodStart, quarter.start))
      .orderBy(asc(lossEntries.periodStart), asc(lossEntries.id))
  )
    .filter((e) => e.periodEnd <= quarter.end)
    .map((e) => ({
      id: e.id,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      stockout: e.stockoutLossRupees,
      overstock: e.overstockWriteoffRupees,
      total: Math.round((e.stockoutLossRupees + e.overstockWriteoffRupees) * 100) / 100,
      note: e.note,
    }));

  // Reversal rate over time: cumulative since the Kill 1 epoch, one point per IST day (non-fallback decisions only).
  const daily = await rows(
    db,
    sql`SELECT (r.reviewed_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
               count(*)::int AS reviewed,
               (count(*) FILTER (WHERE r.outcome = 'rejected'))::int AS reversed
        FROM reviews r JOIN ai_decisions d ON d.id = r.ai_decision_id
        WHERE d.is_fallback = false AND d.valid = true AND r.reviewed_at >= ${kill.kill1.epochStart}
        GROUP BY 1 ORDER BY 1`,
  );
  let cumReviewed = 0;
  let cumReversed = 0;
  const trend: TrendPoint[] = daily.map((d) => {
    cumReviewed += num(d.reviewed);
    cumReversed += num(d.reversed);
    return { day: String(d.day), reviewed: cumReviewed, reversed: cumReversed, ratePct: (cumReversed / cumReviewed) * 100 };
  });

  const reasons = (
    await rows(db, sql`SELECT reason_code::text AS code, count(*)::int AS n FROM reviews WHERE outcome = 'rejected' AND reason_code IS NOT NULL GROUP BY 1 ORDER BY n DESC, code`)
  ).map((r) => ({ code: String(r.code), count: num(r.n) }));

  const runRows = await rows(
    db,
    sql`SELECT ru.id, ru.status::text AS status, (ru.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS date,
               ru.summary_json->>'as_of_date' AS as_of,
               ru.created_at AS created_at,
               coalesce(f.total, 0)::int AS flags, coalesce(f.high, 0)::int AS high,
               coalesce(f.stockout, 0)::int AS stockout, coalesce(f.overstock, 0)::int AS overstock,
               coalesce(d.accepted, 0)::int AS accepted, coalesce(d.rejected, 0)::int AS rejected,
               coalesce(d.fallback, 0)::int AS fallback, d.last_review AS last_review
        FROM runs ru
        LEFT JOIN (
          SELECT run_id, count(*) AS total,
                 count(*) FILTER (WHERE 'HIGH_DEMAND' = ANY(flag_types)) AS high,
                 count(*) FILTER (WHERE 'STOCKOUT_RISK' = ANY(flag_types)) AS stockout,
                 count(*) FILTER (WHERE 'OVERSTOCK_RISK' = ANY(flag_types)) AS overstock
          FROM flags GROUP BY run_id) f ON f.run_id = ru.id
        LEFT JOIN (
          SELECT fl.run_id,
                 count(*) FILTER (WHERE r.outcome = 'accepted') AS accepted,
                 count(*) FILTER (WHERE r.outcome = 'rejected') AS rejected,
                 count(*) FILTER (WHERE ad.is_fallback) AS fallback,
                 max(r.reviewed_at) AS last_review
          FROM ai_decisions ad JOIN flags fl ON fl.id = ad.flag_id LEFT JOIN reviews r ON r.ai_decision_id = ad.id
          GROUP BY fl.run_id) d ON d.run_id = ru.id
        ORDER BY ru.id DESC LIMIT 20`,
  );
  const runs: RunRow[] = runRows.map((r) => ({
    runId: num(r.id),
    date: String(r.date),
    status: String(r.status),
    asOfDate: String(r.as_of),
    flags: num(r.flags),
    high: num(r.high),
    stockout: num(r.stockout),
    overstock: num(r.overstock),
    accepted: num(r.accepted),
    rejected: num(r.rejected),
    fallback: num(r.fallback),
    turnaroundHours: r.last_review ? round1((new Date(r.last_review as string).getTime() - new Date(r.created_at as string).getTime()) / 3_600_000) : null,
  }));

  const [q] = await rows(db, sql`SELECT count(*)::int AS n, (count(*) FILTER (WHERE is_fallback))::int AS fb, (count(*) FILTER (WHERE needs_judgment))::int AS nj FROM ai_decisions`);
  const decisions = num(q.n);

  const [w] = await rows(
    db,
    sql`SELECT count(*)::int AS placed,
               avg((b.placed_at AT TIME ZONE 'Asia/Kolkata')::date - (ru.summary_json->>'as_of_date')::date) AS age_days,
               avg(extract(epoch FROM (b.placed_at - r.reviewed_at)) / 3600) AS lag_hours
        FROM buying_decisions b
        JOIN reviews r ON r.id = b.review_id
        JOIN ai_decisions ad ON ad.id = r.ai_decision_id
        JOIN flags f ON f.id = ad.flag_id
        JOIN runs ru ON ru.id = f.run_id
        WHERE b.status = 'placed' AND b.action <> 'NO_ACTION'`,
  );
  const monthStart = `${today.slice(0, 7)}-01`;
  const [m] = await rows(db, sql`SELECT count(*)::int AS n FROM runs WHERE status = 'completed' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${monthStart}::date`);

  return {
    kill,
    losses,
    baseline: rules.baseline_per_quarter_rupees,
    trend,
    reasons,
    runs,
    quality: {
      decisions,
      fallbackRatePct: decisions === 0 ? null : (num(q.fb) / decisions) * 100,
      needsJudgmentSharePct: decisions === 0 ? null : (num(q.nj) / decisions) * 100,
    },
    workflow: {
      placedOrders: num(w.placed),
      avgDataAgeDays: round1(numOrNull(w.age_days)),
      avgOrderLagHours: round1(numOrNull(w.lag_hours)),
      runsThisMonth: num(m.n),
    },
  };
}
