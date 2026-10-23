import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AccountView } from "@/components/AccountView";
import { AuditView } from "@/components/AuditView";
import { DashboardView } from "@/components/DashboardView";
import { KillView } from "@/components/KillView";
import { LossEntryPanel } from "@/components/LossEntryPanel";
import { NewRunForm } from "@/components/NewRunForm";
import { OrdersBoard } from "@/components/OrdersBoard";
import { ReviewBoard } from "@/components/ReviewBoard";
import { ShellFrame } from "@/components/Shell";
import { StatusBannerView } from "@/components/StatusBanner";
import type { Role } from "@/lib/auth/permissions";
import { auditFixture, dashboardFixture, killEventsFixture, killStatusFixture, ordersFixture, reviewFixture, SCENES, type Scene } from "@/lib/ui-check/fixtures";

// Pages for the browser checks (tests/e2e/ui-audit.spec.ts). They draw the real components with fixed sample data, so
// accessibility and layout can be checked with no database and no sign-in. They exist only when the build is made
// with UI_CHECK=1; in a normal build every one of these routes is a 404.
const ENABLED = process.env.UI_CHECK === "1";

// Cache Components needs at least one static param, so the scenes are always listed; when UI_CHECK is off each one is a 404.
export function generateStaticParams() {
  return SCENES.map((scene) => ({ scene }));
}

function build(scene: Scene): { role: Role; name: string; banner?: ReactNode; body: ReactNode } {
  const quarter = dashboardFixture("green").kill.kill2.loss.quarter;
  const lossEntries = dashboardFixture("green").losses.map((l) => ({ id: l.id, periodStart: l.periodStart, periodEnd: l.periodEnd, stockout: l.stockout, overstock: l.overstock, note: l.note }));
  switch (scene) {
    case "review-raghav":
      return { role: "raghav", name: "Raghav Kulkarni", banner: <StatusBannerView status={killStatusFixture({ kill2: "alert" })} role="raghav" />, body: <ReviewBoard data={reviewFixture} canReview /> };
    case "orders-procurement":
      return { role: "procurement", name: "Procurement User", body: <OrdersBoard data={ordersFixture} canPlace canExport /> };
    case "dashboard-priya":
      return {
        role: "priya",
        name: "Priya Sharma",
        body: (
          <div className="flex flex-col gap-8">
            <DashboardView data={dashboardFixture("green")} canExport />
            <LossEntryPanel entries={lossEntries} quarterLabel={quarter.label} quarterStart={quarter.start} quarterEnd={quarter.end} />
          </div>
        ),
      };
    case "dashboard-alert-deepa":
      return { role: "deepa", name: "Deepa Nair", banner: <StatusBannerView status={killStatusFixture({ kill2: "alert" })} role="deepa" />, body: <DashboardView data={dashboardFixture("alert")} canExport={false} /> };
    case "dashboard-killed-ceo":
      return { role: "ceo", name: "Chief Executive", banner: <StatusBannerView status={killStatusFixture({ kill2: "killed" })} role="ceo" />, body: <DashboardView data={dashboardFixture("killed")} canExport={false} /> };
    case "kill-killed-deepa":
      return {
        role: "deepa",
        name: "Deepa Nair",
        banner: <StatusBannerView status={killStatusFixture({ kill1: "killed", kill2: "killed" })} role="deepa" />,
        body: <KillView status={killStatusFixture({ kill1: "killed", kill2: "killed" })} events={killEventsFixture} canAcknowledge week="2026-W43" />,
      };
    case "kill-alert-deepa":
      return {
        role: "deepa",
        name: "Deepa Nair",
        banner: <StatusBannerView status={killStatusFixture({ kill2: "alert" })} role="deepa" />,
        body: <KillView status={killStatusFixture({ kill2: "alert" })} events={killEventsFixture.slice(2)} canAcknowledge week="2026-W43" />,
      };
    case "audit-deepa":
      return { role: "deepa", name: "Deepa Nair", body: <AuditView log={auditFixture} params={{}} /> };
    case "new-run-raghav":
      return { role: "raghav", name: "Raghav Kulkarni", body: <NewRunForm /> };
    case "new-run-blocked-raghav":
      return {
        role: "raghav",
        name: "Raghav Kulkarni",
        banner: <StatusBannerView status={killStatusFixture({ kill2: "killed" })} role="raghav" />,
        body: <NewRunForm blockedReason="Automation stopped (Kill 2). Use the previous process. A new run cannot start until it is re-armed." />,
      };
    case "account-procurement":
      return { role: "procurement", name: "Procurement User", body: <AccountView user={{ name: "Procurement User", email: "procurement@example.test", role: "procurement" }} /> };
  }
}

async function Scene({ params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  if (!ENABLED || !(SCENES as readonly string[]).includes(scene)) notFound();
  const { role, name, banner, body } = build(scene as Scene);
  return (
    <ShellFrame user={{ name, role }} banner={banner}>
      {body}
    </ShellFrame>
  );
}

export default function UiCheckPage({ params }: { params: Promise<{ scene: string }> }) {
  return (
    <Suspense fallback={null}>
      <Scene params={params} />
    </Suspense>
  );
}
