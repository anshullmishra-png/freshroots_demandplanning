// Kill-switch decisions as pure functions: numbers in, a verdict out (docs/06-KILL-SWITCHES.md).
// Every threshold comes from config/rules.json. No database, no clock, so the boundary tests need neither.
import type { RulesConfig } from "@/lib/config/rules";

export type Kill1Verdict = "collecting" | "ok" | "kill";

export interface Kill1Result {
  verdict: Kill1Verdict;
  reviewed: number;
  reversed: number;
  /** Reversal rate in percent, or null before anything is reviewed. */
  ratePct: number | null;
  minReviewed: number;
  thresholdPct: number;
}

/**
 * KILL 1: reversal monitor. Fires when at least `min_reviewed_decisions` AI decisions have been reviewed and the
 * share Raghav reversed reaches the threshold ("exactly 10% fires"). Counts must already exclude fallback decisions
 * and decisions before the current epoch; this function only applies the rule.
 */
export function evaluateKill1(counts: { reviewed: number; reversed: number }, cfg: RulesConfig["kill_switch_1"]): Kill1Result {
  const { reviewed, reversed } = counts;
  const result = {
    reviewed,
    reversed,
    ratePct: reviewed === 0 ? null : (reversed / reviewed) * 100,
    minReviewed: cfg.min_reviewed_decisions,
    thresholdPct: cfg.reversal_rate_threshold_pct,
  };
  if (!cfg.enabled) return { ...result, verdict: "ok" };
  if (reviewed < cfg.min_reviewed_decisions) return { ...result, verdict: "collecting" };

  // reversed / reviewed >= pct / 100, in integers so a rate of exactly 10% is not lost to rounding.
  const scale = 1_000_000;
  const left = reversed * 100 * scale;
  const right = Math.round(cfg.reversal_rate_threshold_pct * scale) * reviewed;
  const hit = cfg.operator === ">" ? left > right : left >= right;
  return { ...result, verdict: hit ? "kill" : "ok" };
}

export type Kill2Band = "green" | "alert" | "killed";

/**
 * KILL 2: outcome gate. Strictly above the alert level is an alert; strictly above the kill level is killed.
 * Rs 28,00,000 exactly is green, Rs 28,00,001 is an alert, Rs 34,00,000 exactly is still an alert.
 * Compared in paise so no floating-point sum can move a boundary.
 */
export function evaluateKill2(totalRupees: number, cfg: RulesConfig["kill_switch_2"]): Kill2Band {
  if (!cfg.enabled) return "green";
  const paise = Math.round(totalRupees * 100);
  if (paise > Math.round(cfg.kill_above_rupees * 100)) return "killed";
  if (paise > Math.round(cfg.alert_above_rupees * 100)) return "alert";
  return "green";
}

export interface Quarter {
  /** Calendar quarter label such as 2026-Q4. */
  label: string;
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day, YYYY-MM-DD. */
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The quarter a date falls in. Calendar quarters by default (Jan to Mar, Apr to Jun, Jul to Sep, Oct to Dec);
 * `startMonth` from config shifts them (open question 8).
 */
export function quarterOf(isoDate: string, startMonth = 1): Quarter {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`quarterOf: bad date "${isoDate}"`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const index = Math.floor(((month - startMonth + 12) % 12) / 3);
  const firstMonthRaw = startMonth + index * 3; // 1..24
  const firstMonth = ((firstMonthRaw - 1) % 12) + 1;
  const startYear = firstMonth > month ? year - 1 : year;
  const lastMonthRaw = firstMonth + 2;
  const lastMonth = ((lastMonthRaw - 1) % 12) + 1;
  const endYear = startYear + (lastMonthRaw > 12 ? 1 : 0);
  const lastDay = new Date(Date.UTC(endYear, lastMonth, 0)).getUTCDate();
  return {
    label: startMonth === 1 ? `${startYear}-Q${index + 1}` : `${startYear}-${pad(firstMonth)} to ${endYear}-${pad(lastMonth)}`,
    start: `${startYear}-${pad(firstMonth)}-01`,
    end: `${endYear}-${pad(lastMonth)}-${pad(lastDay)}`,
  };
}

/** Rupees as lakhs for display (1 lakh = 100,000). Money is stored in rupees, shown in lakhs. */
export function formatLakhs(rupees: number): string {
  const lakhs = rupees / 100_000;
  return `Rs ${lakhs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lakh`;
}

/** Full rupees in Indian digit grouping, for exact figures: Rs 28,00,001. */
export function formatRupees(rupees: number): string {
  return `Rs ${rupees.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const STOP_MESSAGE = (which: 1 | 2) => `Automation stopped (Kill ${which}). Use the previous process.`;
