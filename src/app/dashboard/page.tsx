import { ComingSoon } from "@/components/ComingSoon";
import { Protected } from "@/components/Shell";

export default function DashboardPage() {
  return (
    <Protected
      permission="view_dashboard"
      render={() => (
        <ComingSoon label="Outcome" title="Dashboard" text="Quarterly loss against the Rs 28 to 34 lakh baseline, reversal rate and both kill-switch cards will appear here. This screen is built in a later phase." />
      )}
    />
  );
}
