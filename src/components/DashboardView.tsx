import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { ChartCard, HBars, LossBand, LossBars, TableView, TrendLine } from "@/components/charts";
import { Card, Label, Pill, btnSecondary, cx, type PillTone } from "@/components/ui";
import { formatLakhs, formatRupees } from "@/lib/kill/logic";
import { METRIC_DEFINITIONS, type DashboardData } from "@/lib/metrics/queries";
import { REASON_LABELS } from "@/lib/review-shared";

/** "What is this?" on every metric: its fixed definition and baseline (guardrail G-M3). Works on touch and keyboard. */
function Definition({ text }: { text: string }) {
  return (
    <details className="mt-3 text-xs text-mutedtext">
      <summary className="min-h-[44px] cursor-pointer py-3 font-semibold text-royal">What is this?</summary>
      <p className="pb-2 leading-5">{text}</p>
    </details>
  );
}

function Kpi({ label, pill, big, note, children }: { label: string; pill?: ReactNode; big: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <Label>{label}</Label>
        {pill}
      </div>
      <p className="mt-2 text-[32px] font-bold leading-tight text-sapphire">{big}</p>
      {note && <p className="mt-1 text-sm text-mutedtext">{note}</p>}
      {children}
    </Card>
  );
}

const KILL2_PILL: Record<"green" | "alert" | "killed", { tone: PillTone; text: string }> = {
  green: { tone: "success", text: "Green" },
  alert: { tone: "active", text: "Alert" },
  killed: { tone: "danger", text: "Killed" },
};

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function DashboardView({ data, canExport }: { data: DashboardData; canExport: boolean }) {
  const { kill, losses, trend, reasons, runs, quality, workflow } = data;
  const k1 = kill.kill1.result;
  const k2 = kill.kill2;
  const pill2 = KILL2_PILL[k2.state];
  const quarter = k2.loss.quarter;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Outcome</Label>
          <h1 className="text-[32px] font-bold leading-tight text-sapphire">Dashboard</h1>
          <p className="text-sm text-mutedtext">
            {quarter.label}: {quarter.start} to {quarter.end}. The loss figure is the judge; everything else only helps explain it.
          </p>
        </div>
        {canExport && (
          <div className="flex flex-wrap gap-2">
            {(["summary", "runs", "losses"] as const).map((kind) => (
              <a key={kind} href={`/api/metrics/export?kind=${kind}`} download className={btnSecondary}>
                <Download size={16} aria-hidden="true" />
                {kind === "summary" ? "Metrics CSV" : `${kind[0].toUpperCase()}${kind.slice(1)} CSV`}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Quarter-to-date loss"
          pill={<Pill tone={pill2.tone}>{pill2.text}</Pill>}
          big={formatLakhs(k2.loss.total)}
          note={`${formatRupees(k2.loss.total)} · ${k2.loss.entries} entr${k2.loss.entries === 1 ? "y" : "ies"}`}
        >
          <LossBand total={k2.loss.total} alertAbove={k2.alertAbove} killAbove={k2.killAbove} state={k2.state} />
          <p className="mt-3 text-xs text-mutedtext">
            Stockout {formatLakhs(k2.loss.stockout)} · overstock {formatLakhs(k2.loss.overstock)}
          </p>
          <Definition text={METRIC_DEFINITIONS.quarterLoss} />
        </Kpi>

        <Kpi
          label="Kill 1: reversal monitor"
          pill={<Pill tone={kill.kill1.state === "killed" ? "danger" : "success"}>{kill.kill1.state === "killed" ? "Killed" : "Armed"}</Pill>}
          big={k1.verdict === "collecting" ? `${k1.reviewed} of ${k1.minReviewed}` : `${(k1.ratePct ?? 0).toFixed(1)}%`}
          note={
            k1.verdict === "collecting"
              ? `Collecting data: ${k1.reviewed} of ${k1.minReviewed} reviews before the 10% check starts`
              : `${k1.reversed} of ${k1.reviewed} reversed. Stops at ${k1.thresholdPct}% or more.`
          }
        >
          <Definition text={METRIC_DEFINITIONS.reversalRate} />
        </Kpi>

        <Kpi
          label="Kill 2: outcome gate"
          pill={<Pill tone={pill2.tone}>{pill2.text}</Pill>}
          big={k2.state === "killed" ? "Stopped" : k2.state === "alert" ? "Monitor" : "On track"}
          note={`Alert above ${formatLakhs(k2.alertAbove)} · stop above ${formatLakhs(k2.killAbove)}`}
        >
          {k2.state === "alert" && (
            <p className="mt-3 text-xs text-mutedtext">
              {kill.needsAcknowledgement ? "Waiting for Deepa's acknowledgement this week." : kill.lastAcknowledgement ? `Acknowledged for ${kill.lastAcknowledgement.week}.` : ""}
            </p>
          )}
          {k2.state === "killed" && <p className="mt-3 text-xs text-mutedtext">Stays stopped, even into a new quarter, until Deepa or the CEO re-arms it.</p>}
          <Definition text="Quarterly loss above the alert level raises an alert; above the kill level stops the automation and returns to the previous process. The baseline is Rs 28 to 34 lakh per quarter." />
        </Kpi>

        <Kpi
          label="Data age at buying"
          big={workflow.avgDataAgeDays === null ? "No orders yet" : `${workflow.avgDataAgeDays} days`}
          note={workflow.avgDataAgeDays === null ? "Average days from the SAP data to placing the order" : `Average over ${workflow.placedOrders} placed orders. Before: 21 to 28 days.`}
        >
          <Definition text={METRIC_DEFINITIONS.dataAge} />
        </Kpi>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Loss in this quarter" hint="One bar per entry Priya has made.">
          {losses.length === 0 ? (
            <p className="text-sm text-mutedtext">No loss entered yet this quarter.</p>
          ) : (
            <>
              <LossBars rows={losses.map((l) => ({ label: `${dayLabel(l.periodStart)} to ${dayLabel(l.periodEnd)}`, stockout: l.stockout, overstock: l.overstock }))} />
              <TableView
                summary="View as a table"
                head={["Period", "Stockout", "Overstock", "Total"]}
                rows={losses.map((l) => [`${l.periodStart} to ${l.periodEnd}`, formatRupees(l.stockout), formatRupees(l.overstock), formatRupees(l.total)])}
              />
            </>
          )}
        </ChartCard>

        <ChartCard title="Reversal rate over time" hint={`Cumulative since ${kill.kill1.epochStart.toISOString().slice(0, 10)}. Fallback decisions are not counted.`}>
          {trend.length === 0 ? (
            <p className="text-sm text-mutedtext">No reviewed AI decisions yet.</p>
          ) : (
            <>
              <TrendLine points={trend.map((t) => ({ label: dayLabel(t.day), value: t.ratePct }))} limit={k1.thresholdPct} limitLabel={`${k1.thresholdPct}% limit`} />
              {k1.verdict === "collecting" && <p className="mt-2 text-xs text-mutedtext">Below {k1.minReviewed} reviews the limit does not apply yet.</p>}
              <TableView
                summary="View as a table"
                head={["Day", "Reviewed", "Reversed", "Rate"]}
                rows={trend.map((t) => [t.day, t.reviewed, t.reversed, `${t.ratePct.toFixed(1)}%`])}
              />
            </>
          )}
          <Definition text={METRIC_DEFINITIONS.reversalRate} />
        </ChartCard>

        <ChartCard title="Why Raghav rejected" hint="Rejections by reason code, all time.">
          {reasons.length === 0 ? (
            <p className="text-sm text-mutedtext">No rejections yet.</p>
          ) : (
            <>
              <HBars items={reasons.map((r) => ({ label: REASON_LABELS[r.code as keyof typeof REASON_LABELS] ?? r.code, value: r.count }))} />
              <TableView summary="View as a table" head={["Reason", "Rejections"]} rows={reasons.map((r) => [REASON_LABELS[r.code as keyof typeof REASON_LABELS] ?? r.code, r.count])} />
            </>
          )}
          <Definition text={METRIC_DEFINITIONS.reasons} />
        </ChartCard>

        <ChartCard title="Flags per run" hint="How many SKUs each run flagged. A SKU can carry more than one flag.">
          {runs.length === 0 ? (
            <p className="text-sm text-mutedtext">No runs yet. Upload this week&apos;s SAP files.</p>
          ) : (
            <>
              <HBars items={[...runs].reverse().map((r) => ({ label: `Run ${r.runId} · ${dayLabel(r.date)}`, value: r.flags }))} />
              <TableView
                summary="View as a table"
                head={["Run", "Flagged", "Stockout", "High demand", "Overstock"]}
                rows={runs.map((r) => [`Run ${r.runId}`, r.flags, r.stockout, r.high, r.overstock])}
              />
            </>
          )}
        </ChartCard>
      </div>

      <Card>
        <h2 className="mb-4 text-2xl font-semibold text-sapphire">Run history</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-mutedtext">No run yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.runId} className="grid grid-cols-2 items-center gap-x-4 gap-y-1 py-3 text-sm hover:bg-rowhover md:grid-cols-[1.4fr_repeat(5,minmax(0,1fr))_auto]">
                <span>
                  <span className="font-bold text-sapphire">Run {r.runId}</span>
                  <span className="block text-xs text-mutedtext">
                    {r.date} · data as of {r.asOfDate}
                  </span>
                </span>
                <span className="text-sapphire">{r.flags} flags</span>
                <span className="text-sapphire">{r.accepted} accepted</span>
                <span className="text-sapphire">{r.rejected} rejected</span>
                <span className={cx(r.fallback > 0 ? "text-sapphire" : "text-mutedtext")}>{r.fallback} fallback</span>
                <span className="text-mutedtext">{r.turnaroundHours === null ? "not reviewed" : `${r.turnaroundHours} h to review`}</span>
                <Pill tone={r.status === "completed" ? "success" : r.status === "blocked" ? "danger" : "quoted"}>{r.status.replace("_", " ")}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-2xl font-semibold text-sapphire">Is the AI trustworthy?</h2>
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-mutedtext">AI fallback rate</dt>
              <dd className="font-bold text-sapphire">{quality.fallbackRatePct === null ? "no decisions" : `${quality.fallbackRatePct.toFixed(1)}%`}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-mutedtext">Needs-judgment share</dt>
              <dd className="font-bold text-sapphire">{quality.needsJudgmentSharePct === null ? "no decisions" : `${quality.needsJudgmentSharePct.toFixed(1)}%`}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-mutedtext">Decisions so far</dt>
              <dd className="font-bold text-sapphire">{quality.decisions}</dd>
            </div>
          </dl>
          <Definition text={`${METRIC_DEFINITIONS.fallbackRate} ${METRIC_DEFINITIONS.needsJudgment}`} />
        </Card>
        <Card>
          <h2 className="mb-2 text-2xl font-semibold text-sapphire">Did the process change?</h2>
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-mutedtext">Runs completed this month (before: 1)</dt>
              <dd className="font-bold text-sapphire">{workflow.runsThisMonth}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-mutedtext">Order lag, review to placed</dt>
              <dd className="font-bold text-sapphire">{workflow.avgOrderLagHours === null ? "no orders placed" : `${workflow.avgOrderLagHours} hours`}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-mutedtext">Orders placed</dt>
              <dd className="font-bold text-sapphire">{workflow.placedOrders}</dd>
            </div>
          </dl>
          <Definition text={`${METRIC_DEFINITIONS.runsPerMonth} ${METRIC_DEFINITIONS.orderLag} ${METRIC_DEFINITIONS.turnaround}`} />
        </Card>
      </div>
    </div>
  );
}
