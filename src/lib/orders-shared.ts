// Order constants and view types shared by the server and the browser. Nothing here may import server-only code.
import type { FinalAction } from "@/lib/review-shared";

export type OrderStatus = "pending" | "placed" | "held" | "cancelled";
export const ORDER_STATUSES: OrderStatus[] = ["pending", "placed", "held", "cancelled"];

export const HELD_MESSAGE = "Automation stopped. Confirm with Raghav before ordering.";

/**
 * What procurement is told to do. A pause is always "hold the next order", never a cancellation of an order that
 * already exists (guardrail G-B4).
 */
export function describeOrder(action: FinalAction, quantity: number, unit = "units"): string {
  if (action === "REORDER") return `Reorder ${quantity} ${unit}`;
  if (action === "PAUSE_ORDER") return "Hold the next order";
  return "No order needed";
}

export interface OrderDto {
  id: number;
  skuId: string;
  skuName: string;
  unit: string;
  action: FinalAction;
  quantity: number;
  status: OrderStatus;
  orderReference: string | null;
  source: "ai_accepted" | "raghav_changed";
  reasonCode: string | null;
  reasonText: string | null;
  aiAction: "REORDER" | "PAUSE_ORDER";
  aiQuantity: number;
  runId: number;
  runDate: string;
  asOfDate: string;
  /** Days between the data's as-of date and the order being placed (or today, while still waiting). */
  dataAgeDays: number;
  placedAt: string | null;
  placedBy: string | null;
  /** The distributor that supplies the SKU: the vendor a Zoho purchase order is made out to. */
  distributorName: string | null;
  /** The draft purchase order in Zoho Inventory, once it has been sent there. */
  zohoPoNumber: string | null;
  zohoPoUrl: string | null;
}

export interface OrdersDto {
  orders: OrderDto[];
  noOrderNeeded: OrderDto[];
  counts: Record<OrderStatus, number>;
  /** Whether Zoho Inventory is connected, and the organisation's name when it is. */
  zoho: { connected: boolean };
}
