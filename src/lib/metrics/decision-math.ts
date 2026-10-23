// The two small calculations behind "what does this decision do?". Pure, so the server and the browser share them.

/** Cover after an order: stock plus the order, over the weekly demand. A hold or no action leaves it where it is. */
export function coverAfter(cover: number, demandRate: number, action: string, quantity: number): number {
  if (action !== "REORDER" || demandRate <= 0) return cover;
  return cover + quantity / demandRate;
}

/** Quarterly exposure (rupees) a decision goes after, given the SKU's share of the baseline under each kind of loss. */
export function exposureFor(action: string | null, share: { stockout: number; overstock: number }): number {
  if (action === "REORDER") return share.stockout;
  if (action === "PAUSE_ORDER") return share.overstock;
  return 0;
}

export type CoverState = "short" | "in range" | "over";
export const coverState = (cover: number, min: number, max: number): CoverState => (cover < min ? "short" : cover > max ? "over" : "in range");
