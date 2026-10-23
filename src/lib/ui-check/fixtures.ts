// Fixed sample data for the browser checks (tests/e2e/ui-audit.spec.ts). It contains no real names, figures or secrets and
// is only ever drawn by /ui-check/*, which returns 404 unless the build was made with UI_CHECK=1.
import type { AuditViewData } from "@/components/AuditView";
import type { Quarter } from "@/lib/kill/logic";
import { evaluateKill1 } from "@/lib/kill/logic";
import type { KillEventRow, KillStatus } from "@/lib/kill/service";
import type { DashboardData } from "@/lib/metrics/queries";
import type { OrderDto, OrdersDto } from "@/lib/orders-shared";
import type { ReviewDataDto, ReviewItemDto } from "@/lib/review-shared";

export const SCENES = [
  "review-raghav",
  "orders-procurement",
  "dashboard-priya",
  "dashboard-alert-deepa",
  "dashboard-killed-ceo",
  "kill-killed-deepa",
  "kill-alert-deepa",
  "audit-deepa",
  "new-run-raghav",
  "new-run-blocked-raghav",
  "account-procurement",
] as const;
export type Scene = (typeof SCENES)[number];

const base: Omit<ReviewItemDto, "aiDecisionId" | "skuId" | "skuName" | "flagTypes"> = {
  perishability: "Low",
  coverWeeks: 3.35,
  minCover: 6,
  maxCover: 14,
  demandRatio: 1.21,
  unitsOnHand: 900,
  standardQty: 500,
  action: "REORDER",
  quantity: 750,
  explanation:
    "Freshroots Mango Drink 200ml has 3.35 weeks of cover, below the allowed 6 to 14 weeks, while recent demand is high. A 25% festival uplift was applied. The decision is to reorder 750 units.",
  confidence: "HIGH",
  needsJudgment: false,
  judgmentNote: null,
  judgmentReasons: [],
  isFallback: false,
  status: "pending_review",
  review: null,
};

const reviewItems: ReviewItemDto[] = [
  { ...base, aiDecisionId: 1, skuId: "SKU003", skuName: "Freshroots Brown Rice 1kg", flagTypes: ["STOCKOUT_RISK"], coverWeeks: 4.36, demandRatio: 1.0, unitsOnHand: 820, explanation: "Freshroots Brown Rice 1kg has 4.36 weeks of cover, below the allowed 6 to 14 weeks. A 25% festival uplift was applied. The decision is to reorder 300 units.", needsJudgment: true, confidence: "LOW", judgmentReasons: ["A week with zero sales in the last 12 weeks."], judgmentNote: "A zero-sales week sits in the window.", quantity: 300 },
  { ...base, aiDecisionId: 2, skuId: "SKU001", skuName: "Freshroots Mango Drink 200ml", flagTypes: ["HIGH_DEMAND", "STOCKOUT_RISK"] },
  { ...base, aiDecisionId: 3, skuId: "SKU004", skuName: "Freshroots Almond Milk 500ml", flagTypes: ["STOCKOUT_RISK"], perishability: "High", coverWeeks: 1.8, minCover: 3, maxCover: 4, quantity: 150, isFallback: true, confidence: null, explanation: "Cover is 1.8 weeks against a minimum of 3. Rule engine recommends reordering 150 units." },
  { ...base, aiDecisionId: 4, skuId: "SKU006", skuName: "Freshroots Quinoa 500g", flagTypes: ["OVERSTOCK_RISK"], coverWeeks: 22.23, action: "PAUSE_ORDER", quantity: 0, unitsOnHand: 1100, explanation: "Cover is 22.23 weeks, above the allowed maximum of 14. The decision is to pause the next order." },
  { ...base, aiDecisionId: 5, skuId: "SKU007", skuName: "Freshroots Coconut Water 330ml", flagTypes: ["OVERSTOCK_RISK"], status: "reviewed", action: "PAUSE_ORDER", quantity: 0, review: { outcome: "accepted", finalAction: "PAUSE_ORDER", finalQty: 0, finalFlagTypes: ["OVERSTOCK_RISK"], reasonCode: null, reasonText: null } },
  { ...base, aiDecisionId: 6, skuId: "SKU011", skuName: "Freshroots Multigrain Bread 400g", flagTypes: ["STOCKOUT_RISK"], status: "reviewed", quantity: 500, review: { outcome: "rejected", finalAction: "REORDER", finalQty: 400, finalFlagTypes: ["STOCKOUT_RISK"], reasonCode: "WRONG_QUANTITY", reasonText: "The distributor can only supply a smaller batch." } },
  { ...base, aiDecisionId: 7, skuId: "SKU013", skuName: "Freshroots Peanut Butter 300g", flagTypes: ["STOCKOUT_RISK"], status: "voided_by_kill", quantity: 120 },
];

export const reviewFixture: ReviewDataDto = {
  run: {
    id: 12,
    createdAt: "2026-10-22T09:00:00.000Z",
    rulesVersion: "1.3.0",
    status: "in_review",
    fallbackWarning: true,
    asOfDate: "2026-10-19",
    isFestival: true,
    skipped: [{ sku_id: "SKU900", reason: "No sales history (possible new launch). Not forecast." }],
  },
  items: reviewItems,
  counts: { total: 7, pending: 4, accepted: 1, rejected: 1, voided: 1, fallback: 1 },
  fallbackWarningPct: 30,
};

const order = (over: Partial<OrderDto>): OrderDto => ({
  id: 1,
  skuId: "SKU001",
  skuName: "Freshroots Mango Drink 200ml",
  unit: "Units",
  action: "REORDER",
  quantity: 750,
  status: "pending",
  orderReference: null,
  source: "ai_accepted",
  reasonCode: null,
  reasonText: null,
  aiAction: "REORDER",
  aiQuantity: 750,
  runId: 12,
  runDate: "2026-10-22",
  asOfDate: "2026-10-19",
  dataAgeDays: 4,
  placedAt: null,
  placedBy: null,
  ...over,
});

export const ordersFixture: OrdersDto = {
  orders: [
    order({ id: 1 }),
    order({ id: 2, skuId: "SKU003", skuName: "Freshroots Brown Rice 1kg", quantity: 300, aiQuantity: 300, source: "raghav_changed", reasonCode: "WRONG_QUANTITY", reasonText: "Smaller batch this week.", aiAction: "REORDER" }),
    order({ id: 3, skuId: "SKU006", skuName: "Freshroots Quinoa 500g", action: "PAUSE_ORDER", quantity: 0, aiAction: "PAUSE_ORDER", aiQuantity: 0 }),
    order({ id: 4, skuId: "SKU011", skuName: "Freshroots Multigrain Bread 400g", quantity: 500, aiQuantity: 500, status: "held" }),
    order({ id: 5, skuId: "SKU004", skuName: "Freshroots Almond Milk 500ml", quantity: 150, aiQuantity: 150, status: "placed", orderReference: "PO-2026-1017", placedAt: "2026-10-22T10:00:00.000Z", placedBy: "Procurement User", dataAgeDays: 3 }),
  ],
  noOrderNeeded: [order({ id: 6, skuId: "SKU013", skuName: "Freshroots Peanut Butter 300g", action: "NO_ACTION", quantity: 0, source: "raghav_changed", reasonCode: "MARKET_EVENT" })],
  counts: { pending: 3, placed: 1, held: 1, cancelled: 0 },
};

const quarter: Quarter = { label: "2026-Q4", start: "2026-10-01", end: "2026-12-31" };

export function killStatusFixture(opts: { kill1?: "armed" | "killed"; kill2?: "green" | "alert" | "killed"; total?: number; needsAck?: boolean } = {}): KillStatus {
  const kill1 = opts.kill1 ?? "armed";
  const kill2 = opts.kill2 ?? "green";
  const total = opts.total ?? (kill2 === "killed" ? 3_500_000 : kill2 === "alert" ? 2_900_000 : 1_100_000);
  const counts = kill1 === "killed" ? { reviewed: 30, reversed: 3 } : { reviewed: 12, reversed: 1 };
  const stoppedBy: Array<1 | 2> = [...(kill1 === "killed" ? [1 as const] : []), ...(kill2 === "killed" ? [2 as const] : [])];
  return {
    stopped: stoppedBy.length > 0,
    stoppedBy,
    kill1: { state: kill1, epochStart: new Date("2026-10-01T00:00:00Z"), result: evaluateKill1(counts, { enabled: true, min_reviewed_decisions: 30, reversal_rate_threshold_pct: 10, operator: ">=", scope: "", reversal_definition: "", exclude_ai_fallback_decisions: true, counts_only_reviewed_decisions: true, restart_count_on_rearm: true }) },
    kill2: {
      state: kill2,
      band: kill2,
      loss: { quarter, stockout: total * 0.7, overstock: total * 0.3, total, entries: 3 },
      alertAbove: 2_800_000,
      killAbove: 3_400_000,
    },
    needsAcknowledgement: opts.needsAck ?? kill2 === "alert",
    lastAcknowledgement: null,
  };
}

export function dashboardFixture(state: "green" | "alert" | "killed"): DashboardData {
  return {
    kill: killStatusFixture({ kill2: state }),
    losses: [
      { id: 1, periodStart: "2026-10-01", periodEnd: "2026-10-07", stockout: 600_000, overstock: 200_000, total: 800_000, note: "Week 40" },
      { id: 2, periodStart: "2026-10-08", periodEnd: "2026-10-14", stockout: 450_000, overstock: 150_000, total: 600_000, note: null },
      { id: 3, periodStart: "2026-10-15", periodEnd: "2026-10-22", stockout: 900_000, overstock: 400_000, total: 1_300_000, note: "Festival week" },
    ],
    baseline: { stockout_low: 1_800_000, stockout_high: 2_200_000, overstock_low: 1_000_000, overstock_high: 1_200_000, total_low: 2_800_000, total_high: 3_400_000 },
    trend: [
      { day: "2026-10-19", reviewed: 7, reversed: 1, ratePct: 14.3 },
      { day: "2026-10-21", reviewed: 14, reversed: 1, ratePct: 7.1 },
      { day: "2026-10-23", reviewed: 21, reversed: 2, ratePct: 9.5 },
    ],
    reasons: [
      { code: "WRONG_QUANTITY", count: 4 },
      { code: "MARKET_EVENT", count: 2 },
      { code: "WRONG_FLAG", count: 1 },
    ],
    runs: [
      { runId: 3, date: "2026-10-23", status: "in_review", asOfDate: "2026-10-19", flags: 7, high: 1, stockout: 5, overstock: 2, accepted: 3, rejected: 1, fallback: 0, turnaroundHours: 2.5 },
      { runId: 2, date: "2026-10-21", status: "completed", asOfDate: "2026-10-19", flags: 6, high: 0, stockout: 4, overstock: 2, accepted: 6, rejected: 0, fallback: 0, turnaroundHours: 1.2 },
      { runId: 1, date: "2026-10-19", status: "blocked", asOfDate: "2026-10-16", flags: 8, high: 2, stockout: 5, overstock: 3, accepted: 5, rejected: 2, fallback: 1, turnaroundHours: null },
    ],
    quality: { decisions: 21, fallbackRatePct: 4.8, needsJudgmentSharePct: 9.5 },
    workflow: { placedOrders: 12, avgDataAgeDays: 3.5, avgOrderLagHours: 5.2, runsThisMonth: 2 },
  };
}

export const killEventsFixture: KillEventRow[] = [
  { id: 3, killSwitch: 2, event: "rearmed", metricValue: 3_500_000, threshold: 3_400_000, details: { reason: "Reviewed with the CEO; continuing under a close watch." }, createdAt: new Date("2026-10-23T12:00:00Z"), acknowledgedBy: null, acknowledgedAt: null },
  { id: 2, killSwitch: 2, event: "killed", metricValue: 3_500_000, threshold: 3_400_000, details: {}, createdAt: new Date("2026-10-23T10:00:00Z"), acknowledgedBy: null, acknowledgedAt: null },
  { id: 1, killSwitch: 2, event: "alert", metricValue: 2_900_000, threshold: 2_800_000, details: {}, createdAt: new Date("2026-10-22T10:00:00Z"), acknowledgedBy: "Head of Operations", acknowledgedAt: new Date("2026-10-22T11:00:00Z") },
];

export const auditFixture: AuditViewData = {
  rows: [
    { id: 5, at: new Date("2026-10-23T10:00:00Z"), actor: "Senior Planner", action: "review.accepted", entity: "ai_decision", entityId: "41", before: { action: "REORDER", quantity: 750 }, after: { action: "REORDER", quantity: 750 } },
    { id: 4, at: new Date("2026-10-23T09:30:00Z"), actor: null, action: "kill2.fired", entity: "kill_switch", entityId: "2", before: null, after: { total: 3_500_000 } },
    { id: 3, at: new Date("2026-10-22T09:00:00Z"), actor: "Data Analyst", action: "loss_entry.created", entity: "loss_entry", entityId: "2", before: null, after: { stockoutLossRupees: 600_000 } },
  ],
  total: 3,
  page: 1,
  pages: 1,
  actions: ["kill2.fired", "loss_entry.created", "review.accepted"],
  actors: [{ id: 1, name: "Senior Planner" }, { id: 2, name: "Data Analyst" }],
};
