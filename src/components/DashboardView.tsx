import { BarChart3, ClipboardCheck, Download, FileSearch, PackageCheck, ShieldCheck, TrendingDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ChartCard, HBars, LossBand, LossBars, TableView, TrendLine } from "@/components/charts";
import { Card, IconBadge, Label, PageHeader, Pill, ProgressBar, btnSecondary, cx, type PillTone } from "@/components/ui";
import { formatLakhs, formatRupees } from "@/lib/kill/logic";
import { METRIC_DEFINITIONS, type DashboardData } from "@/lib/metrics/queries";
import { REASON_LABELS } from "@/lib/review-shared";

/** "What is this?" on every metric: its fixed definition and baseline (guardrail G-M3). Works on touch and keyboard. */
function Definition({ text }: { text: string }) {
  return (
    <details className="mt-3 text-xs text-mutedtext">
      <summary className="min-h-[44px] cursor-pointer py-3 font-semibold text-royaltext">What is this?</summary>
      <p className="pb-2 leading-5">{text}</p>
    </details>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="-mb-2">
      <h2 className="text-xl font-bold text-sapphire">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-mutedtext">{hint}</p>}
    </div>
  );
}

function Kpi({
  icon,
  label,
  sub,
  pill,
  big,
  note,
  children,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  pill?: ReactNode;
  big: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <IconBadge icon={icon} />
          <div className="leading-tight">
            <Label>{label}</Label>
            {sub && <p className="text-xs text-mutedtext">{sub}</p>}
          </div>
        </div>
        {pill}
      </div>
      <p className="mt-4 text-[28px] font-bold leading-tight tracking-tight text-sapphire">{big}</p>
      {note && <p className="mt-1 text-sm leading-5 text-mutedtext">{note}</p>}
      {children}
    </Card>
  );
}

/** A chart with nothing to draw yet: say what will appear and who makes it appear. */
function Waiting({ icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-box bg-highlight p-4">
      <IconBadge icon={icon} />
      <div>
        <p className="font-semibold text-sapphire">{title}</p>
        <p className="mt-0.5 text-sm leading-5 text-mutedtext">{children}</p>
      </div>
    </div>
  );
}

const KILL2_PILL: Record<"green" | "alert" | "killed", { tone: PillTone; text: string }> = {
  green: { tone: "success", text: "On track" },
  alert: { tone: "active", text: "Alert" },
  killed: { tone: "danger", text: "Stopped" },
};

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function DashboardView({ data, canExport }: { data: DashboardData; canExport: boolean }) {
  const { kill, losses, trend, reasons, runs, quality, workflow } = data;
  const k1 = kill.kill1.result;
  const k2 = kill.kill2;
  const pill2 = KILL2_PILL[k2.state];
  const quarter = k2.loss.quarter;
  const headroom = k2.alertAbove - k2.loss.total;
  const headline =
    k2.state === "killed"
      ? "The loss limit was crossed and the automation is stopped. The previous manual process is in use until it is re-armed."
      : k2.state === "alert"
        ? `Loss is above the alert level. ${formatLakhs(k2.killAbove - k2.loss.total)} is left before the automation stops.`
        : `Within the limit. ${formatLakhs(headroom)} is left before the alert level.`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`Business outcome · ${quarter.label}`}
        title="Dashboard"
        subtitle={`How Freshroots is doing against its loss target for ${quarter.start} to ${quarter.end}. The loss figure is the judge; everything else helps explain it.`}
        actions={
          canExport
            ? (["summary", "runs", "losses"] as const).map((kind) => (
                <a key={kind} href={`/api/metrics/export?kind=${kind}`} download className={btnSecondary}>
                  <Download size={16} aria-hidden="true" />
                  {kind === "summary" ? "Metrics CSV" : `${kind[0].toUpperCase()}${kind.slice(1)} CSV`}
                </a>
              ))
            : undefined
        }
      />

      <Card className="grid gap-6 border-l-4 border-l-gold lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <div className="flex items-center gap-3">
            <Label>Loss this quarter so far</Label>
            <Pill tone={pill2.tone}>{pill2.text}</Pill>
          </div>
          <p className="mt-2 text-[44px] font-bold leading-none tracking-tight text-sapphire">{formatLakhs(k2.loss.total)}</p>
          <p className="mt-2 text-sm text-mutedtext">
            {formatRupees(k2.loss.total)} from {k2.loss.entries} entr{k2.loss.entries === 1 ? "y" : "ies"} · stockout {formatLakhs(k2.loss.stockout)} · overstock {formatLakhs(k2.loss.overstock)}
          </p>
          <p className="mt-3 text-base font-semibold leading-6 text-sapphire">{headline}</p>
        </div>
        <div>
          <LossBand total={k2.loss.total} alertAbove={k2.alertAbove} killAbove={k2.killAbove} state={k2.state} />
          <p className="mt-3 text-xs leading-5 text-mutedtext">
            Before this system, quarterly loss was Rs 28 to 34 lakh. The alert is at {formatLakhs(k2.alertAbove)}; above {formatLakhs(k2.killAbove)} the automation stops itself.
          </p>
          <Definition text={METRIC_DEFINITIONS.quarterLoss} />
        </div>
      </Card>

      <SectionTitle title="Is the AI safe to rely on?" hint="Two switches watch it. Either one stops the automation on its own." />
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={ClipboardCheck}
          label="AI trust check"
          sub="Kill switch 1"
          pill={<Pill tone={kill.kill1.state === "killed" ? "danger" : "success"}>{kill.kill1.state === "killed" ? "Stopped" : "Armed"}</Pill>}
          big={k1.verdict === "collecting" ? `${k1.reviewed} of ${k1.minReviewed}` : `${(k1.ratePct ?? 0).toFixed(1)}%`}
          note={
            k1.verdict === "collecting"
              ? `reviewed decisions. The check starts at ${k1.minReviewed}: it stops the AI if Raghav overrules ${k1.thresholdPct}% or more.`
              : `${k1.reversed} of ${k1.reviewed} overruled. It stops at ${k1.thresholdPct}% or more.`
          }
        >
          {k1.verdict === "collecting" && (
            <div className="mt-3">
              <ProgressBar value={k1.reviewed} max={k1.minReviewed} label="Reviewed decisions before the check starts" />
            </div>
          )}
          <Definition text={METRIC_DEFINITIONS.reversalRate} />
        </Kpi>

        <Kpi
          icon={ShieldCheck}
          label="Loss limit"
          sub="Kill switch 2"
          pill={<Pill tone={pill2.tone}>{pill2.text}</Pill>}
          big={k2.state === "killed" ? "Stopped" : k2.state === "alert" ? "Monitor closely" : "On track"}
          note={`Alert above ${formatLakhs(k2.alertAbove)} · stops above ${formatLakhs(k2.killAbove)}`}
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
          icon={FileSearch}
          label="AI reliability"
          sub="Fallback rate"
          big={quality.fallbackRatePct === null ? "No decisions yet" : `${quality.fallbackRatePct.toFixed(1)}%`}
          note={quality.decisions === 0 ? "Share of decisions where the AI failed and the rule engine answered instead." : `of ${quality.decisions} decisions were the rule engine's own answer.`}
        >
          <Definition text={`${METRIC_DEFINITIONS.fallbackRate} ${METRIC_DEFINITIONS.needsJudgment}`} />
        </Kpi>

        <Kpi
          icon={PackageCheck}
          label="Speed to order"
          sub="Data age at buying"
          big={workflow.avgDataAgeDays === null ? "No orders yet" : `${workflow.avgDataAgeDays} days`}
          note={workflow.avgDataAgeDays === null ? "Days from the SAP data to the order being placed. It was 21 to 28 days before." : `Average over ${workflow.placedOrders} placed orders. Before: 21 to 28 days.`}
        >
          <Definition text={METRIC_DEFINITIONS.dataAge} />
        </Kpi>
      </div>

      <SectionTitle title="What is happening" hint="The numbers behind the headline." />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Loss in this quarter" hint="One bar per entry Priya has made.">
          {losses.length === 0 ? (
            <Waiting icon={TrendingDown} title="No loss entered yet">
              Priya enters the quarter&apos;s stockout and overstock loss from her own records. Each entry appears here as a bar and is checked against the limit at once.
            </Waiting>
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

        <ChartCard title="How often the AI is overruled" hint={`Cumulative since ${kill.kill1.epochStart.toISOString().slice(0, 10)}. Fallback decisions are not counted.`}>
          {trend.length === 0 ? (
            <Waiting icon={BarChart3} title="Waiting for the first reviews">
              Each time Raghav accepts or changes an AI decision it is counted here. The line must stay under {k1.thresholdPct}%.
            </Waiting>
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
        </ChartCard>

        <ChartCard title="Why Raghav rejected" hint="Rejections by reason, all time. This is how the rules and the prompt get better.">
          {reasons.length === 0 ? (
            <Waiting icon={ClipboardCheck} title="No rejections yet">
              When Raghav overrules the AI he must pick a reason. The reasons collect here.
            </Waiting>
          ) : (
            <>
              <HBars items={reasons.map((r) => ({ label: REASON_LABELS[r.code as keyof typeof REASON_LABELS] ?? r.code, value: r.count }))} />
              <TableView summary="View as a table" head={["Reason", "Rejections"]} rows={reasons.map((r) => [REASON_LABELS[r.code as keyof typeof REASON_LABELS] ?? r.code, r.count])} />
            </>
          )}
          <Definition text={METRIC_DEFINITIONS.reasons} />
        </ChartCard>

        <ChartCard title="SKUs flagged per run" hint="How many SKUs each run flagged. A SKU can carry more than one flag.">
          {runs.length === 0 ? (
            <Waiting icon={BarChart3} title="No runs yet">
              Raghav uploads the SAP files each week and the rules flag the SKUs at risk of running out or piling up.
            </Waiting>
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
        <h3 className="mb-4 text-lg font-semibold text-sapphire">Run history</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-mutedtext">No run yet.</p>
        ) : (
          <div>
            <div className="hidden grid-cols-[1.4fr_repeat(5,minmax(0,1fr))_auto] gap-x-4 border-b border-border pb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-mutedtext md:grid">
              <span>Run</span>
              <span>Flagged</span>
              <span>Accepted</span>
              <span>Rejected</span>
              <span>AI fallback</span>
              <span>Review time</span>
              <span>Status</span>
            </div>
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
                  <span className="text-mutedtext">{r.turnaroundHours === null ? "not reviewed" : `${r.turnaroundHours} h`}</span>
                  <Pill tone={r.status === "completed" ? "success" : r.status === "blocked" ? "danger" : "quoted"}>{r.status.replace("_", " ")}</Pill>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-lg font-semibold text-sapphire">Did the process change?</h3>
        <p className="mb-3 text-sm text-mutedtext">Before the system: one run a month and orders placed 21 to 28 days after the data.</p>
        <dl className="grid divide-y divide-border text-sm md:grid-cols-3 md:divide-x md:divide-y-0">
          <div className="py-3 md:px-4 md:first:pl-0">
            <dt className="text-mutedtext">Runs completed this month (before: 1)</dt>
            <dd className="mt-1 text-2xl font-bold text-sapphire">{workflow.runsThisMonth}</dd>
          </div>
          <div className="py-3 md:px-4">
            <dt className="text-mutedtext">Time from review to order placed</dt>
            <dd className="mt-1 text-2xl font-bold text-sapphire">{workflow.avgOrderLagHours === null ? "No orders yet" : `${workflow.avgOrderLagHours} hours`}</dd>
          </div>
          <div className="py-3 md:px-4">
            <dt className="text-mutedtext">Needs-judgment share of decisions</dt>
            <dd className="mt-1 text-2xl font-bold text-sapphire">{quality.needsJudgmentSharePct === null ? "No decisions yet" : `${quality.needsJudgmentSharePct.toFixed(1)}%`}</dd>
          </div>
        </dl>
        <Definition text={`${METRIC_DEFINITIONS.runsPerMonth} ${METRIC_DEFINITIONS.orderLag} ${METRIC_DEFINITIONS.turnaround}`} />
      </Card>
    </div>
  );
}
