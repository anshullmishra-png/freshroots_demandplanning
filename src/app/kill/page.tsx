import { getDb } from "@/db/client";
import { AcknowledgeButton, RearmForm } from "@/components/KillActions";
import { Protected } from "@/components/Shell";
import { Card, Label, Pill } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { formatWeek, isoWeekOf, istDate, parseIsoDate } from "@/lib/dates/isoWeek";
import { STOP_MESSAGE, formatLakhs, formatRupees } from "@/lib/kill/logic";
import { getKillStatus, listKillEvents } from "@/lib/kill/service";

export const metadata = { title: "Kill and alerts | Freshroots Demand Planning" };

const when = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default function KillPage() {
  return (
    <Protected
      permission="rearm_kill"
      render={async (user) => {
        const db = getDb();
        const [status, events] = await Promise.all([getKillStatus(db), listKillEvents(db)]);
        const { kill1, kill2 } = status;
        const week = formatWeek(isoWeekOf(parseIsoDate(istDate(new Date()))!));
        const refireWarning =
          kill2.band === "killed"
            ? `This quarter's loss is ${formatRupees(kill2.loss.total)}, still above the ${formatRupees(kill2.killAbove)} kill level. Re-arming does not erase any loss entry, so Kill 2 will fire again on the next check.`
            : null;

        return (
          <div className="flex flex-col gap-8">
            <div>
              <Label>Kill switches</Label>
              <h1 className="text-[32px] font-bold leading-tight text-sapphire">Kill and alerts</h1>
              <p className="text-sm text-mutedtext">Both switches watch outside the workflow. Only Deepa or the CEO can re-arm one, with a written reason.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-2xl font-semibold text-sapphire">Kill 1: reversal monitor</h2>
                  <Pill tone={kill1.state === "killed" ? "danger" : "success"}>{kill1.state === "killed" ? "Killed" : "Armed"}</Pill>
                </div>
                <p className="mt-2 text-sm text-sapphire">
                  {kill1.result.reviewed} reviewed, {kill1.result.reversed} reversed
                  {kill1.result.ratePct !== null && ` (${kill1.result.ratePct.toFixed(1)}%)`}. Stops at {kill1.result.thresholdPct}% or more once {kill1.result.minReviewed} are reviewed.
                </p>
                <p className="mt-1 text-xs text-mutedtext">Counting since {when(kill1.epochStart)}.</p>
                {kill1.state === "killed" && (
                  <>
                    <p className="mt-3 rounded-btn bg-dangermutedbg px-3 py-2 text-sm font-semibold text-dangermuted">{STOP_MESSAGE(1)}</p>
                    <RearmForm which={1} refireWarning={null} />
                  </>
                )}
              </Card>

              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-2xl font-semibold text-sapphire">Kill 2: outcome gate</h2>
                  <Pill tone={kill2.state === "killed" ? "danger" : kill2.state === "alert" ? "active" : "success"}>
                    {kill2.state === "killed" ? "Killed" : kill2.state === "alert" ? "Alert" : "Green"}
                  </Pill>
                </div>
                <p className="mt-2 text-sm text-sapphire">
                  {kill2.loss.quarter.label}: {formatRupees(kill2.loss.total)} ({formatLakhs(kill2.loss.total)}). Alert above {formatLakhs(kill2.alertAbove)}, stop above {formatLakhs(kill2.killAbove)}.
                </p>
                {kill2.state === "alert" && (
                  <div className="mt-3">
                    {status.needsAcknowledgement ? (
                      can(user.role, "ack_alert") ? (
                        <AcknowledgeButton week={week} />
                      ) : (
                        <p className="rounded-btn bg-gold/20 px-3 py-2 text-sm font-semibold text-sapphire">Waiting for Deepa to acknowledge this week&apos;s alert.</p>
                      )
                    ) : (
                      <p className="text-sm text-mutedtext">
                        Acknowledged for {status.lastAcknowledgement?.week}
                        {status.lastAcknowledgement?.by ? ` by ${status.lastAcknowledgement.by}` : ""}. Due again next week while the alert lasts.
                      </p>
                    )}
                  </div>
                )}
                {kill2.state === "killed" && (
                  <>
                    <p className="mt-3 rounded-btn bg-dangermutedbg px-3 py-2 text-sm font-semibold text-dangermuted">{STOP_MESSAGE(2)}</p>
                    <RearmForm which={2} refireWarning={refireWarning} />
                  </>
                )}
              </Card>
            </div>

            <Card>
              <h2 className="mb-4 text-2xl font-semibold text-sapphire">History</h2>
              {events.length === 0 ? (
                <p className="text-sm text-mutedtext">Nothing has fired yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {events.map((e) => (
                    <li key={e.id} className="grid gap-x-4 gap-y-1 py-3 text-sm hover:bg-rowhover md:grid-cols-[10rem_6rem_6rem_1fr]">
                      <span className="text-mutedtext">{when(e.createdAt)}</span>
                      <span className="font-bold text-sapphire">Kill {e.killSwitch}</span>
                      <span>
                        <Pill tone={e.event === "killed" ? "danger" : e.event === "alert" ? "active" : "success"}>{e.event}</Pill>
                      </span>
                      <span className="text-sapphire">
                        {e.killSwitch === 2 ? `${formatRupees(e.metricValue)} against ${formatRupees(e.threshold)}` : `${e.metricValue.toFixed(1)}% against ${e.threshold}%`}
                        {typeof e.details.reason === "string" && <span className="block text-mutedtext">Reason: {e.details.reason}</span>}
                        {e.acknowledgedBy && <span className="block text-mutedtext">First acknowledged by {e.acknowledgedBy}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    />
  );
}
