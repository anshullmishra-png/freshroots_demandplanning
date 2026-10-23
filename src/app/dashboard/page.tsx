import { getDb } from "@/db/client";
import { DashboardView } from "@/components/DashboardView";
import { LossEntryPanel } from "@/components/LossEntryPanel";
import { Protected } from "@/components/Shell";
import { can } from "@/lib/auth/permissions";
import { getDashboard } from "@/lib/metrics/queries";

export const metadata = { title: "Dashboard | Freshroots Demand Planning" };

export default function DashboardPage() {
  return (
    <Protected
      permission="view_dashboard"
      render={async (user) => {
        const data = await getDashboard(getDb());
        const quarter = data.kill.kill2.loss.quarter;
        return (
          <div className="flex flex-col gap-8">
            <DashboardView data={data} canExport={can(user.role, "export_metrics")} />
            {can(user.role, "enter_loss") && (
              <LossEntryPanel
                quarterLabel={quarter.label}
                quarterStart={quarter.start}
                quarterEnd={quarter.end}
                entries={data.losses.map((l) => ({ id: l.id, periodStart: l.periodStart, periodEnd: l.periodEnd, stockout: l.stockout, overstock: l.overstock, note: l.note }))}
              />
            )}
          </div>
        );
      }}
    />
  );
}
