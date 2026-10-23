import { AlertTriangle, OctagonX } from "lucide-react";
import Link from "next/link";
import { getDb } from "@/db/client";
import { can, type Role } from "@/lib/auth/permissions";
import { STOP_MESSAGE, formatLakhs } from "@/lib/kill/logic";
import { getKillStatus } from "@/lib/kill/service";

/**
 * The strip under the header on every signed-in page (guardrail G-U3). A killed state is always visible, for every
 * role. A Kill 2 alert is a gold strip. Muted colours only: never a vibrant red (G-U1).
 */
export async function StatusBanner({ role }: { role: Role }) {
  const status = await getKillStatus(getDb());
  const href = can(role, "rearm_kill") ? "/kill" : "/dashboard";

  if (status.stopped) {
    return (
      <div role="alert" className="border-b border-dangermuted/40 bg-dangermutedbg text-dangermuted">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-4 py-3 md:px-8">
          <OctagonX size={20} aria-hidden="true" className="shrink-0" />
          <div className="min-w-0 flex-1 text-sm font-semibold">
            {status.stoppedBy.map((which) => (
              <p key={which}>
                {STOP_MESSAGE(which)}{" "}
                <span className="font-normal">
                  {which === 1
                    ? `${status.kill1.result.reversed} of ${status.kill1.result.reviewed} reviewed AI decisions were reversed (${(status.kill1.result.ratePct ?? 0).toFixed(1)}%).`
                    : `Quarter-to-date loss is ${formatLakhs(status.kill2.loss.total)}, above the ${formatLakhs(status.kill2.killAbove)} kill level.`}
                </span>
              </p>
            ))}
          </div>
          <Link href={href} className="min-h-[44px] rounded-btn border-2 border-dangermuted px-4 py-2.5 text-sm font-bold">
            See why
          </Link>
        </div>
      </div>
    );
  }

  if (status.kill2.state === "alert") {
    return (
      <div role="status" className="border-b border-gold/60 bg-gold/20 text-sapphire">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-4 py-3 md:px-8">
          <AlertTriangle size={20} aria-hidden="true" className="shrink-0" />
          <p className="min-w-0 flex-1 text-sm font-semibold">
            Loss alert: quarter-to-date loss is {formatLakhs(status.kill2.loss.total)}, above the {formatLakhs(status.kill2.alertAbove)} alert level. Monitor closely.
            {status.needsAcknowledgement && <span className="font-normal"> Deepa still needs to acknowledge it this week.</span>}
          </p>
          <Link href={href} className="min-h-[44px] rounded-btn border-2 border-sapphire px-4 py-2.5 text-sm font-bold">
            Details
          </Link>
        </div>
      </div>
    );
  }
  return null;
}
