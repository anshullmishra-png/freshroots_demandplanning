import type { OrderStatus } from "@/lib/orders-shared";
import type { FinalAction } from "@/lib/review-shared";
import { toCsv } from "./csv";
import { describeOrder } from "@/lib/orders-shared";

/** A reviewed buying decision, as the order sinks see it. */
export interface BuyingDecision {
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
  runId: number;
  asOfDate: string;
  /** The distributor that supplies this SKU (from the SKU master): the vendor a purchase order is made out to. */
  distributorName?: string | null;
}

export interface SinkResult {
  ref: string;
  results: Array<{ sku_id: string; ok: boolean; error?: string; decisionId?: number; purchaseOrderId?: string; purchaseOrderNumber?: string }>;
  /** Only the CSV sink returns content: the file to download. */
  content?: string;
}

/**
 * Where final decisions go (docs/11-DEPLOYMENT-AND-ENV.md). The first release ships `CsvSink` only. A later
 * `ZohoSink` must create draft purchase orders only and wait for procurement to confirm (guardrail G-B3).
 */
export interface OrderSink {
  name: "csv" | "zoho";
  createDraftOrders(decisions: BuyingDecision[]): Promise<SinkResult>;
}

export const ORDER_CSV_HEADER = [
  "order_id",
  "sku_id",
  "sku_name",
  "action",
  "instruction",
  "quantity",
  "unit",
  "source",
  "reason_code",
  "reason_text",
  "run_id",
  "data_as_of",
  "status",
  "order_reference",
];

export class CsvSink implements OrderSink {
  readonly name = "csv" as const;

  async createDraftOrders(decisions: BuyingDecision[]): Promise<SinkResult> {
    const rows = decisions.map((d) => [
      d.id,
      d.skuId,
      d.skuName,
      d.action,
      describeOrder(d.action, d.quantity, d.unit),
      d.quantity,
      d.unit,
      d.source === "ai_accepted" ? "AI accepted" : "Raghav changed",
      d.reasonCode,
      d.reasonText,
      d.runId,
      d.asOfDate,
      d.status,
      d.orderReference,
    ]);
    return {
      ref: `csv:${decisions.length}-rows`,
      results: decisions.map((d) => ({ sku_id: d.skuId, ok: true })),
      content: toCsv([ORDER_CSV_HEADER, ...rows]),
    };
  }
}
