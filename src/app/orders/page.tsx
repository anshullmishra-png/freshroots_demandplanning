import { getDb } from "@/db/client";
import { OrdersBoard } from "@/components/OrdersBoard";
import { Protected } from "@/components/Shell";
import { can } from "@/lib/auth/permissions";
import type { OrderDto, OrdersDto } from "@/lib/orders-shared";
import { getOrders, type OrderRow } from "@/lib/workflow/orders";

export const metadata = { title: "Orders | Freshroots Demand Planning" };

const toDto = (o: OrderRow): OrderDto => ({
  id: o.id,
  skuId: o.skuId,
  skuName: o.skuName,
  unit: o.unit,
  action: o.action,
  quantity: o.quantity,
  status: o.status,
  orderReference: o.orderReference,
  source: o.source,
  reasonCode: o.reasonCode,
  reasonText: o.reasonText,
  aiAction: o.aiAction,
  aiQuantity: o.aiQuantity,
  runId: o.runId,
  runDate: o.runDate,
  asOfDate: o.asOfDate,
  dataAgeDays: o.dataAgeDays,
  placedAt: o.placedAt ? o.placedAt.toISOString() : null,
  placedBy: o.placedBy,
});

export default function OrdersPage() {
  return (
    <Protected
      permission="view_orders"
      render={async (user) => {
        const result = await getOrders(getDb(), { status: "all" });
        const dto: OrdersDto = { orders: result.orders.map(toDto), noOrderNeeded: result.noOrderNeeded.map(toDto), counts: result.counts };
        return <OrdersBoard data={dto} canPlace={can(user.role, "mark_placed")} canExport={can(user.role, "export_orders")} />;
      }}
    />
  );
}
