import { ComingSoon } from "@/components/ComingSoon";
import { Protected } from "@/components/Shell";

export default function OrdersPage() {
  return (
    <Protected
      permission="view_orders"
      render={() => (
        <ComingSoon label="Procurement" title="Orders" text="Reviewed buying decisions will be listed here for procurement. This screen is built in the next phase." />
      )}
    />
  );
}
