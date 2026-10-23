import Link from "next/link";
import { getDb } from "@/db/client";
import { Protected } from "@/components/Shell";
import { ReviewBoard } from "@/components/ReviewBoard";
import { Card, btnPrimary } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { loadRules } from "@/lib/config/rules";
import type { ReviewDataDto } from "@/lib/review-shared";
import { HeldOrders } from "@/components/HeldOrders";
import { getOrders } from "@/lib/workflow/orders";
import { getRunData } from "@/lib/metrics/insights";
import { getReviewData, latestRunId } from "@/lib/workflow/review";

export const metadata = { title: "Review | Freshroots Demand Planning" };

export default function ReviewPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  return (
    <Protected
      permission="view_review"
      render={async (user) => {
        const db = getDb();
        const wanted = Number((await searchParams).run);
        const runId = Number.isInteger(wanted) && wanted > 0 ? wanted : await latestRunId(db);
        if (runId === null) {
          return (
            <Card>
              <h1 className="text-2xl font-semibold text-sapphire">No run yet</h1>
              <p className="mt-2 text-mutedtext">Upload this week&apos;s SAP files to create the first run.</p>
              {can(user.role, "start_run") && (
                <Link href="/run/new" className={`${btnPrimary} mt-4`}>
                  New run
                </Link>
              )}
            </Card>
          );
        }
        const data = await getReviewData(db, runId);
        const dto: ReviewDataDto = {
          ...data,
          run: { ...data.run, createdAt: data.run.createdAt.toISOString() },
          items: data.items.map((i) => ({
            ...i,
            review: i.review
              ? {
                  outcome: i.review.outcome,
                  finalAction: i.review.finalAction,
                  finalQty: i.review.finalQty,
                  finalFlagTypes: i.review.finalFlagTypes,
                  reasonCode: i.review.reasonCode,
                  reasonText: i.review.reasonText,
                }
              : null,
          })),
          fallbackWarningPct: loadRules().ai.fallback_warning_pct,
          exposure: (await getRunData(db, runId))?.bySku ?? {},
        };
        const canReview = can(user.role, "review");
        // After a kill, orders wait here for Raghav's written confirmation before procurement can place them.
        const held = canReview ? (await getOrders(db, { status: "held" })).orders : [];
        return (
          <div className="flex flex-col gap-8">
            {held.length > 0 && (
              <HeldOrders orders={held.map((o) => ({ id: o.id, skuId: o.skuId, skuName: o.skuName, unit: o.unit, action: o.action, quantity: o.quantity, runId: o.runId }))} />
            )}
            <ReviewBoard data={dto} canReview={canReview} canContinue={can(user.role, "start_run")} />
          </div>
        );
      }}
    />
  );
}
