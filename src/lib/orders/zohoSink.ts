import { createHash } from "node:crypto";
import { ZohoError, type ZohoClient } from "@/lib/zoho/client";
import type { BuyingDecision, OrderSink, SinkResult } from "./sink";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The same selection of decisions always gets the same reference, so a retry finds the order it already made. */
export function purchaseOrderReference(decisionIds: number[]): string {
  const key = [...decisionIds].sort((a, b) => a - b).join(",");
  return `FR-${createHash("sha1").update(key).digest("hex").slice(0, 12).toUpperCase()}`;
}

/**
 * Sends reviewed orders to Zoho Inventory as DRAFT purchase orders, one per distributor (guardrail G-B3). It never
 * issues, approves or cancels one: that is procurement's step in Zoho. It never sets a price: the buying price comes
 * from the item in Zoho, or procurement fills it in before issuing. Holds are instructions, not orders, and are skipped.
 */
export class ZohoSink implements OrderSink {
  readonly name = "zoho" as const;

  constructor(
    private readonly client: ZohoClient,
    private readonly today: string,
  ) {}

  async createDraftOrders(decisions: BuyingDecision[]): Promise<SinkResult> {
    const results: SinkResult["results"] = [];
    const orders = decisions.filter((d) => d.action === "REORDER" && d.quantity > 0);
    for (const d of decisions) {
      if (d.action === "REORDER" && d.quantity > 0) continue;
      results.push({ sku_id: d.skuId, decisionId: d.id, ok: false, error: "Not an order: a hold stays an instruction in the app." });
    }
    if (orders.length === 0) return { ref: "zoho:none", results };

    const [vendors, items] = await Promise.all([this.client.listVendors(), this.client.listItems()]);
    const vendorByName = new Map(vendors.map((v) => [norm(v.name), v]));
    const itemBySku = new Map(items.filter((i) => i.sku).map((i) => [norm(i.sku), i]));

    const groups = new Map<string, BuyingDecision[]>();
    for (const d of orders) {
      const key = norm(d.distributorName);
      if (!key) {
        results.push({ sku_id: d.skuId, decisionId: d.id, ok: false, error: "This SKU has no distributor in the SKU master, so there is no vendor to order from." });
        continue;
      }
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }

    const numbers: string[] = [];
    for (const [key, group] of groups) {
      const vendor = vendorByName.get(key);
      const name = group[0].distributorName!;
      if (!vendor) {
        for (const d of group) results.push({ sku_id: d.skuId, decisionId: d.id, ok: false, error: `Vendor "${name}" is not in Zoho.` });
        continue;
      }
      const lines: Array<{ d: BuyingDecision; itemId: string }> = [];
      for (const d of group) {
        const item = itemBySku.get(norm(d.skuId));
        if (!item) results.push({ sku_id: d.skuId, decisionId: d.id, ok: false, error: `Item ${d.skuId} is not in Zoho.` });
        else lines.push({ d, itemId: item.id });
      }
      if (lines.length === 0) continue;

      try {
        const reference = purchaseOrderReference(lines.map((l) => l.d.id));
        const existing = await this.client.findPurchaseOrderByReference(reference);
        const runs = [...new Set(lines.map((l) => `run ${l.d.runId} (data as of ${l.d.asOfDate})`))].join(", ");
        const po =
          existing ??
          (await this.client.createPurchaseOrder({
            vendorId: vendor.id,
            reference,
            date: this.today,
            notes: `Drafted by Freshroots demand planning from ${runs}. Every line was reviewed by Raghav. Check the price, then issue.`,
            lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.d.quantity })),
          }));
        numbers.push(po.number);
        for (const l of lines) results.push({ sku_id: l.d.skuId, decisionId: l.d.id, ok: true, purchaseOrderId: po.id, purchaseOrderNumber: po.number });
      } catch (e) {
        const message = e instanceof ZohoError ? e.message : "Zoho could not be reached.";
        for (const l of lines) results.push({ sku_id: l.d.skuId, decisionId: l.d.id, ok: false, error: message });
      }
    }
    return { ref: numbers.length ? `zoho:${numbers.join(",")}` : "zoho:none", results };
  }
}
