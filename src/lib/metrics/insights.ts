import { desc, sql } from "drizzle-orm";
import { runs } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { parseWeek, weekFromIndex, weekIndex, lastCompleteWeek, parseIsoDate } from "@/lib/dates/isoWeek";
import { formatLakhs } from "@/lib/kill/logic";
import { runRuleEngine } from "@/lib/rules/engine";
import { describeDecision } from "@/lib/review-shared";
import { coverAfter, exposureFor } from "./decision-math";
import { loadSnapshotData } from "@/lib/workflow/runs";

// What the dashboard and the review screen draw beyond the headline numbers. Everything here comes from the uploaded
// data and the decisions made on it; the only estimate is the loss exposure, which spreads the case's own baseline.

export interface CoverPoint {
  skuId: string;
  name: string;
  cover: number;
  min: number;
  max: number;
  units: number;
  flagTypes: string[];
  /** Cover after the decision Raghav made (a reorder adds its quantity), or null while he has not decided. */
  after: number | null;
}
export interface DemandWeek {
  week: string;
  label: string;
  units: number;
  festival: boolean;
}
export interface ActivityItem {
  at: string;
  text: string;
}
export interface Funnel {
  flagged: number;
  reviewed: number;
  toOrder: number;
  placed: number;
}
export interface Exposure {
  /** Quarterly baseline mid-points from config/rules.json (stockout and overstock), in rupees. */
  baselineStockout: number;
  baselineOverstock: number;
  /** What the flagged SKUs put at stake, and how much of it the decisions made so far address. */
  atStake: number;
  addressed: number;
  bySku: Record<string, { stockout: number; overstock: number }>;
}
export interface InsightsData {
  runId: number;
  asOfDate: string;
  isFestival: boolean;
  covers: CoverPoint[];
  flagMix: { stockout: number; high: number; overstock: number; total: number };
  demand: DemandWeek[];
  funnel: Funnel;
  exposure: Exposure;
  activity: ActivityItem[];
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const mid = (a: number, b: number) => (a + b) / 2;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function rows(db: AnyDb, q: ReturnType<typeof sql>): Promise<Row[]> {
  return ((await db.execute(q)) as unknown as { rows: Row[] }).rows;
}

export { coverAfter, exposureFor };

export async function latestRunId(db: AnyDb): Promise<number | null> {
  const [r] = await db.select({ id: runs.id }).from(runs).orderBy(desc(runs.id)).limit(1);
  return r?.id ?? null;
}

/** What the uploaded data says about one run: cover per SKU, weekly demand, and each SKU's share of the quarterly baseline. */
export async function getRunData(db: AnyDb, runId: number, rules: RulesConfig = loadRules()) {
  const [run] = await rows(db, sql`SELECT snapshot_id FROM runs WHERE id = ${runId}`);
  if (!run) return null;
  const { data } = await loadSnapshotData(db, num(run.snapshot_id), rules);
  const result = runRuleEngine(data, rules);
  const names = new Map(data.skus.map((s) => [s.sku_id, s.name]));

  const asOf = parseIsoDate(data.asOfDate)!;
  const lastIdx = weekIndex(lastCompleteWeek(asOf));
  const from = lastIdx - rules.rules.average_window_weeks + 1;
  const volume = new Map<string, number>();
  const perWeek = new Map<number, number>();
  for (const s of data.sales) {
    const w = parseWeek(s.week);
    if (!w) continue;
    const idx = weekIndex(w);
    perWeek.set(idx, (perWeek.get(idx) ?? 0) + s.units_sold);
    if (idx >= from && idx <= lastIdx) volume.set(s.sku_id, (volume.get(s.sku_id) ?? 0) + s.units_sold);
  }
  const forecast = new Set(result.covers.map((c) => c.sku_id));
  const total = [...volume.entries()].filter(([id]) => forecast.has(id)).reduce((a, [, v]) => a + v, 0) || 1;
  const b = rules.baseline_per_quarter_rupees;
  const baselineStockout = mid(b.stockout_low, b.stockout_high);
  const baselineOverstock = mid(b.overstock_low, b.overstock_high);
  const bySku: Exposure["bySku"] = {};
  for (const c of result.covers) {
    const share = (volume.get(c.sku_id) ?? 0) / total;
    bySku[c.sku_id] = { stockout: Math.round(share * baselineStockout), overstock: Math.round(share * baselineOverstock) };
  }

  const demand: DemandWeek[] = [...perWeek.entries()]
    .sort((a, c) => a[0] - c[0])
    .map(([idx, units]) => {
      const w = weekFromIndex(idx);
      const monday = new Date(idx * 7 * 86_400_000 + 4 * 86_400_000);
      const cal = data.calendar.find((c) => c.year === monday.getUTCFullYear() && c.month === monday.getUTCMonth() + 1);
      return { week: `${w.year}-W${String(w.week).padStart(2, "0")}`, label: `${monday.getUTCDate()} ${MONTHS[monday.getUTCMonth()]}`, units, festival: cal?.is_festival ?? false };
    });

  return { asOfDate: data.asOfDate, isFestival: result.is_festival, covers: result.covers, names, bySku, demand, baselineStockout, baselineOverstock };
}

function sentence(a: Row): string | null {
  const who = a.actor ? String(a.actor) : "The system";
  const sku = a.sku ? String(a.sku) : "a SKU";
  const after = (a.after_json ?? {}) as Record<string, unknown>;
  switch (String(a.action)) {
    case "run.created":
      return `${who} started a new run`;
    case "run.ai_done":
      return "AI recommendations are ready for review";
    case "review.accepted":
      return `${who} accepted ${sku}: ${describeDecision(after.action as "REORDER", num(after.quantity))}`;
    case "review.rejected":
      return `${who} changed ${sku} to ${describeDecision(after.action as "REORDER", num(after.quantity))}`;
    case "buying_decision.placed":
      return `${who} placed the order for ${sku}`;
    case "loss_entry.created":
      return `${who} entered a loss of ${formatLakhs(num(after.stockoutLossRupees) + num(after.overstockWriteoffRupees))}`;
    case "kill2.alert":
      return "Loss alert raised: quarterly loss passed the alert level";
    case "kill2.fired":
      return "Automation stopped: quarterly loss passed the limit";
    case "kill1.fired":
      return "Automation stopped: the AI was overruled too often";
    case "kill.rearmed":
      return `${who} re-armed the safety switch`;
    case "alert.acknowledged":
      return `${who} acknowledged the loss alert`;
    default:
      return null;
  }
}

const ACTIVITY_ACTIONS = ["run.created", "run.ai_done", "review.accepted", "review.rejected", "buying_decision.placed", "loss_entry.created", "kill2.alert", "kill2.fired", "kill1.fired", "kill.rearmed", "alert.acknowledged"];

/** Everything for the dashboard's infographics, for the latest run. Null when nothing has been run yet. */
export async function getInsights(db: AnyDb, rules: RulesConfig = loadRules()): Promise<InsightsData | null> {
  const runId = await latestRunId(db);
  if (runId === null) return null;
  const run = await getRunData(db, runId, rules);
  if (!run) return null;

  const decisions = await rows(
    db,
    sql`SELECT f.sku_id, f.flag_types, f.rule_action::text AS rule_action, f.demand_rate, f.cover_weeks,
               r.outcome::text AS outcome, r.final_action::text AS final_action, r.final_qty,
               bd.status::text AS bstatus
        FROM flags f
        JOIN ai_decisions ad ON ad.flag_id = f.id
        LEFT JOIN reviews r ON r.ai_decision_id = ad.id
        LEFT JOIN buying_decisions bd ON bd.review_id = r.id
        WHERE f.run_id = ${runId}`,
  );

  const bySkuDecision = new Map(decisions.map((d) => [String(d.sku_id), d]));
  const covers: CoverPoint[] = run.covers.map((c) => {
    const d = bySkuDecision.get(c.sku_id);
    const decided = d && d.outcome ? d : null;
    return {
      skuId: c.sku_id,
      name: run.names.get(c.sku_id) ?? c.sku_id,
      cover: c.cover_weeks,
      min: c.min_cover,
      max: c.max_cover,
      units: c.units_on_hand,
      flagTypes: c.flag_types,
      after: decided ? coverAfter(c.cover_weeks, c.demand_rate, String(decided.final_action), num(decided.final_qty)) : null,
    };
  });

  const typeCount = (t: string) => decisions.filter((d) => (d.flag_types as string[]).includes(t)).length;
  const flagMix = { stockout: typeCount("STOCKOUT_RISK"), high: typeCount("HIGH_DEMAND"), overstock: typeCount("OVERSTOCK_RISK"), total: decisions.length };

  const reviewed = decisions.filter((d) => d.outcome);
  const orders = reviewed.filter((d) => d.final_action !== "NO_ACTION" && d.bstatus && d.bstatus !== "cancelled");
  const funnel: Funnel = { flagged: decisions.length, reviewed: reviewed.length, toOrder: orders.length, placed: orders.filter((d) => d.bstatus === "placed").length };

  let atStake = 0;
  let addressed = 0;
  for (const d of decisions) {
    const share = run.bySku[String(d.sku_id)] ?? { stockout: 0, overstock: 0 };
    atStake += exposureFor(String(d.rule_action), share);
    if (d.outcome) addressed += exposureFor(String(d.final_action), share);
  }

  const feed = await rows(
    db,
    sql`SELECT a.action, a.created_at, a.after_json, u.name AS actor, coalesce(f.sku_id, bd.sku_id) AS sku
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_id
        LEFT JOIN ai_decisions ad ON ad.id = CASE WHEN a.entity = 'ai_decision' THEN a.entity_id::int END
        LEFT JOIN flags f ON f.id = ad.flag_id
        LEFT JOIN buying_decisions bd ON bd.id = CASE WHEN a.entity = 'buying_decision' THEN a.entity_id::int END
        WHERE a.action IN (${sql.join(ACTIVITY_ACTIONS.map((x) => sql`${x}`), sql`, `)})
        ORDER BY a.id DESC LIMIT 8`,
  );
  const activity = feed.flatMap((a) => {
    const text = sentence(a);
    return text ? [{ at: new Date(a.created_at as string).toISOString(), text }] : [];
  });

  return {
    runId,
    asOfDate: run.asOfDate,
    isFestival: run.isFestival,
    covers,
    flagMix,
    demand: run.demand,
    funnel,
    exposure: { baselineStockout: run.baselineStockout, baselineOverstock: run.baselineOverstock, atStake, addressed, bySku: run.bySku },
    activity,
  };
}
