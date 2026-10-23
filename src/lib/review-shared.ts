// Constants and view types shared by the server (services, pages) and the browser (client components).
// Nothing here may import server-only code: no database, no AI, no Node modules.

export const FLAG_TYPES = ["HIGH_DEMAND", "STOCKOUT_RISK", "OVERSTOCK_RISK"] as const;
export const FINAL_ACTIONS = ["REORDER", "PAUSE_ORDER", "NO_ACTION"] as const;
export const REASON_CODES = [
  "WRONG_QUANTITY",
  "WRONG_ACTION",
  "WRONG_FLAG",
  "DATA_LOOKS_WRONG",
  "MARKET_EVENT",
  "NEW_LAUNCH_OR_DISTRIBUTOR_CHANGE",
  "OTHER",
] as const;

export type FlagType = (typeof FLAG_TYPES)[number];
export type FinalAction = (typeof FINAL_ACTIONS)[number];
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABELS: Record<ReasonCode, string> = {
  WRONG_QUANTITY: "Wrong quantity",
  WRONG_ACTION: "Wrong action",
  WRONG_FLAG: "Wrong flag",
  DATA_LOOKS_WRONG: "Data looks wrong",
  MARKET_EVENT: "Market event",
  NEW_LAUNCH_OR_DISTRIBUTOR_CHANGE: "New launch or distributor change",
  OTHER: "Other (explain)",
};

export const FLAG_LABELS: Record<string, string> = {
  HIGH_DEMAND: "High demand",
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock risk",
};

export const ACTION_LABELS: Record<FinalAction, string> = {
  REORDER: "Reorder",
  PAUSE_ORDER: "Pause next order",
  NO_ACTION: "No action",
};

/** "Reorder 750 units", "Pause next order", "No action". */
export function describeDecision(action: FinalAction, quantity: number, unit = "units"): string {
  if (action === "REORDER") return `Reorder ${quantity} ${unit}`;
  return ACTION_LABELS[action];
}

export interface ReviewItemDto {
  aiDecisionId: number;
  skuId: string;
  skuName: string;
  perishability: "Low" | "High";
  flagTypes: string[];
  coverWeeks: number;
  minCover: number;
  maxCover: number;
  demandRatio: number;
  unitsOnHand: number;
  standardQty: number;
  /** What the deterministic rule engine decided, before the AI. */
  ruleAction: "REORDER" | "PAUSE_ORDER";
  ruleQty: number;
  demandRate: number;
  action: "REORDER" | "PAUSE_ORDER";
  quantity: number;
  explanation: string;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  needsJudgment: boolean;
  judgmentNote: string | null;
  judgmentReasons: string[];
  isFallback: boolean;
  status: "pending_review" | "reviewed" | "voided_by_kill";
  review: null | {
    outcome: "accepted" | "rejected";
    finalAction: FinalAction;
    finalQty: number;
    finalFlagTypes: string[];
    reasonCode: string | null;
    reasonText: string | null;
  };
}

export interface ReviewDataDto {
  run: {
    id: number;
    createdAt: string;
    rulesVersion: string;
    status: string;
    fallbackWarning: boolean;
    flagCount: number;
    asOfDate: string;
    isFestival: boolean;
    skipped: Array<{ sku_id: string; reason: string }>;
  };
  items: ReviewItemDto[];
  counts: { total: number; pending: number; accepted: number; rejected: number; voided: number; fallback: number };
  fallbackWarningPct: number;
  /** Each SKU's quarterly share of the baseline loss, in rupees: stockout side and overstock side (an estimate). */
  exposure: Record<string, { stockout: number; overstock: number }>;
}
