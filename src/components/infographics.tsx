import { formatLakhs } from "@/lib/kill/logic";
import type { ActivityItem, CoverPoint, DemandWeek, Exposure, Funnel } from "@/lib/metrics/insights";
import { cx, ProgressBar } from "@/components/ui";
import { coverState } from "@/lib/metrics/decision-math";
import { TableView } from "@/components/charts";

// The dashboard's pictures. Plain SVG and HTML in the design system's colours; every picture has its words and a
// table, so colour is never the only way to read it.

const severity = (c: CoverPoint) => (c.cover < c.min ? 0 : c.cover > c.max ? 1 : 2);
const state = coverState;

function Swatch({ className, children }: { className: string; children: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cx("inline-block h-3 w-3 shrink-0", className)} aria-hidden="true" />
      {children}
    </li>
  );
}

/** Each SKU's weeks of cover against its allowed range. The ring marks where Raghav's decision takes it. */
export function CoverChart({ items }: { items: CoverPoint[] }) {
  const sorted = [...items].sort((a, b) => severity(a) - severity(b) || (severity(a) === 0 ? a.cover - b.cover : b.cover - a.cover) || a.skuId.localeCompare(b.skuId));
  const scale = Math.max(...items.flatMap((i) => [i.max * 1.35, i.cover * 1.08, (i.after ?? 0) * 1.08]), 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;
  const decided = items.filter((i) => i.after !== null).length;
  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-sapphire">
        <Swatch className="rounded-sm bg-sapphire/15">Allowed range</Swatch>
        <Swatch className="rounded-full bg-gold">Short of stock</Swatch>
        <Swatch className="rounded-full bg-sapphire">In range</Swatch>
        <Swatch className="rounded-full bg-dangermuted">Too much stock</Swatch>
        <Swatch className="rounded-full border-2 border-emerald bg-white">After Raghav&apos;s decision</Swatch>
      </ul>
      <ul className="flex flex-col gap-2.5" aria-label="Weeks of cover per SKU">
        {sorted.map((c) => {
          const s = state(c.cover, c.min, c.max);
          const dot = s === "short" ? "bg-gold" : s === "over" ? "bg-dangermuted" : "bg-sapphire";
          const lo = Math.min(c.cover, c.after ?? c.cover);
          const hi = Math.max(c.cover, c.after ?? c.cover);
          return (
            <li key={c.skuId} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_minmax(0,6.5rem)] items-center gap-3 text-xs">
              <span className="truncate text-sapphire" title={`${c.skuId} ${c.name}`}>
                <span className="font-bold">{c.skuId}</span> <span className="text-mutedtext">{c.name.replace(/^Freshroots /, "")}</span>
              </span>
              <span className="relative block h-3 rounded-full bg-track/30" role="img" aria-label={`${c.skuId}: ${c.cover.toFixed(1)} weeks of cover, ${s}, allowed ${c.min} to ${c.max}${c.after !== null ? `, ${c.after.toFixed(1)} after the decision` : ""}`}>
                <span className="absolute inset-y-0 rounded-full bg-sapphire/15" style={{ left: pct(c.min), width: `calc(${pct(c.max)} - ${pct(c.min)})` }} />
                {c.after !== null && c.after !== c.cover && <span className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-emerald" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />}
                <span className={cx("absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white", dot)} style={{ left: pct(c.cover) }} />
                {c.after !== null && <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-emerald bg-white" style={{ left: pct(c.after) }} />}
              </span>
              <span className="text-right font-semibold text-sapphire">
                {c.cover.toFixed(1)}
                {c.after !== null && c.after !== c.cover ? ` → ${c.after.toFixed(1)}` : ""} wk
                <span className="block text-[10px] font-bold uppercase tracking-wide text-mutedtext">{s}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-mutedtext">
        {decided === 0 ? "Rings appear as Raghav decides: each shows how much cover the order adds." : `${decided} of ${items.filter((i) => i.flagTypes.length > 0).length} flagged SKUs decided so far.`}
      </p>
      <TableView
        summary="View as a table"
        head={["SKU", "Name", "Cover now (wk)", "Allowed", "Status", "After decision (wk)"]}
        rows={sorted.map((c) => [c.skuId, c.name, c.cover.toFixed(2), `${c.min} to ${c.max}`, state(c.cover, c.min, c.max), c.after === null ? "not decided" : c.after.toFixed(2)])}
      />
    </div>
  );
}

const DONUT = [
  { key: "stockout", label: "Stockout risk", bar: "stroke-gold", dot: "bg-gold" },
  { key: "high", label: "High demand", bar: "stroke-sapphire", dot: "bg-sapphire" },
  { key: "overstock", label: "Overstock risk", bar: "stroke-dangermuted", dot: "bg-dangermuted" },
] as const;

/** Why SKUs were flagged. A SKU with two flags counts once under each, so the centre shows the SKU count. */
export function FlagDonut({ mix }: { mix: { stockout: number; high: number; overstock: number; total: number } }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const sum = mix.stockout + mix.high + mix.overstock;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`${mix.total} SKUs flagged: ${mix.stockout} stockout risk, ${mix.high} high demand, ${mix.overstock} overstock risk`}>
        <circle cx="70" cy="70" r={r} fill="none" className="stroke-track/30" strokeWidth="16" />
        {sum > 0 &&
          DONUT.map((d) => {
            const v = mix[d.key];
            if (v === 0) return null;
            const len = (v / sum) * c;
            const el = <circle key={d.key} cx="70" cy="70" r={r} fill="none" className={d.bar} strokeWidth="16" strokeDasharray={`${Math.max(len - 3, 0)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
            offset += len;
            return el;
          })}
        <text x="70" y="68" textAnchor="middle" className="fill-sapphire text-[28px] font-bold">
          {mix.total}
        </text>
        <text x="70" y="86" textAnchor="middle" className="fill-mutedtext text-[10px] font-semibold uppercase tracking-wider">
          SKUs flagged
        </text>
      </svg>
      <ul className="flex flex-col gap-2 text-sm">
        {DONUT.map((d) => (
          <li key={d.key} className="flex items-center gap-3">
            <span className={cx("h-3 w-3 rounded-full", d.dot)} aria-hidden="true" />
            <span className="w-32 text-sapphire">{d.label}</span>
            <span className="font-bold text-sapphire">{mix[d.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Units sold each week across all SKUs, with festival months shaded: the demand the rules are reacting to. */
export function DemandChart({ weeks }: { weeks: DemandWeek[] }) {
  if (weeks.length === 0) return null;
  const W = 640;
  const H = 210;
  const pad = { l: 44, r: 16, t: 14, b: 28 };
  const max = Math.max(...weeks.map((w) => w.units)) * 1.12;
  const x = (i: number) => pad.l + (weeks.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (weeks.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = weeks.map((w, i) => `${x(i)},${y(w.units)}`).join(" ");
  const area = `${x(0)},${y(0)} ${line} ${x(weeks.length - 1)},${y(0)}`;
  const step = (W - pad.l - pad.r) / Math.max(weeks.length - 1, 1);
  const bands: Array<{ from: number; to: number }> = [];
  weeks.forEach((w, i) => {
    if (!w.festival) return;
    const last = bands.at(-1);
    if (last && last.to === i - 1) last.to = i;
    else bands.push({ from: i, to: i });
  });
  const ticks = [0, 0.5, 1].map((t) => Math.round((max / 1.12) * t));
  const peak = weeks.reduce((a, w) => (w.units > a.units ? w : a));
  const latest = weeks.at(-1)!;
  const every = Math.ceil(weeks.length / 6);
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-sapphire">
        <Swatch className="rounded-sm bg-sapphire">Units sold per week, all SKUs</Swatch>
        <Swatch className="rounded-sm bg-gold/30">Festival month</Swatch>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Weekly units sold across all SKUs over ${weeks.length} weeks. Latest ${latest.units}, peak ${peak.units} in the week of ${peak.label}.`}>
        {bands.map((b) => (
          <rect key={b.from} x={x(b.from) - step / 2} y={pad.t} width={(b.to - b.from + 1) * step} height={H - pad.t - pad.b} className="fill-gold/25" />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-mutedtext text-[10px]">
              {t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}
            </text>
          </g>
        ))}
        <polygon points={area} className="fill-sapphire/10" />
        <polyline points={line} fill="none" className="stroke-sapphire" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {weeks.map((w, i) => (
          <circle key={w.week} cx={x(i)} cy={y(w.units)} r={i === weeks.length - 1 ? 5 : 3} className="fill-sapphire stroke-surface" strokeWidth={2}>
            <title>{`${w.label}: ${w.units} units`}</title>
          </circle>
        ))}
        {weeks.map((w, i) =>
          i % every === 0 || i === weeks.length - 1 ? (
            <text key={`l${w.week}`} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === weeks.length - 1 ? "end" : "middle"} className="fill-mutedtext text-[10px]">
              {w.label}
            </text>
          ) : null,
        )}
      </svg>
      <TableView summary="View as a table" head={["Week", "Starts", "Units sold", "Festival month"]} rows={weeks.map((w) => [w.week, w.label, w.units, w.festival ? "yes" : "no"])} />
    </div>
  );
}

const STEPS: Array<{ key: keyof Funnel; label: string; bar: string }> = [
  { key: "flagged", label: "Flagged by the rules", bar: "bg-sapphire/30" },
  { key: "reviewed", label: "Reviewed by Raghav", bar: "bg-sapphire" },
  { key: "toOrder", label: "Orders to place", bar: "bg-gold" },
  { key: "placed", label: "Orders placed", bar: "bg-emerald" },
];

/** Flagged to reviewed to ordered to placed: where this week's decisions have got to. */
export function FunnelChart({ funnel }: { funnel: Funnel }) {
  const top = Math.max(funnel.flagged, 1);
  return (
    <ul className="flex flex-col gap-3" aria-label="Decision pipeline">
      {STEPS.map((s) => (
        <li key={s.key} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-sapphire">{s.label}</span>
            <span className="text-lg font-bold text-sapphire">{funnel[s.key]}</span>
          </div>
          <div className="h-3 rounded-full bg-track/30" role="img" aria-label={`${s.label}: ${funnel[s.key]} of ${funnel.flagged}`}>
            <div className={cx("h-full rounded-full", s.bar)} style={{ width: `${(funnel[s.key] / top) * 100}%`, minWidth: funnel[s.key] > 0 ? "0.75rem" : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** How much of the quarter's baseline loss the decisions made so far go after. An estimate, and labelled as one. */
export function ExposureMeter({ exposure }: { exposure: Exposure }) {
  return (
    <div>
      <p className="text-[32px] font-bold leading-tight tracking-tight text-sapphire">{formatLakhs(exposure.addressed)}</p>
      <p className="text-sm text-mutedtext">of {formatLakhs(exposure.atStake)} at stake this week</p>
      <div className="mt-3">
        <ProgressBar value={exposure.addressed} max={Math.max(exposure.atStake, 1)} label="Loss exposure addressed" tone="emerald" />
      </div>
      <details className="mt-3 text-xs text-mutedtext">
        <summary className="min-h-[44px] cursor-pointer py-3 font-semibold text-royaltext">How is this worked out?</summary>
        <p className="pb-2 leading-5">
          An estimate, not a measured loss. The case&apos;s own quarterly baseline ({formatLakhs(exposure.baselineStockout)} stockout, {formatLakhs(exposure.baselineOverstock)} overstock, the middle of each range) is shared across SKUs by how much each sells. A reorder
          counts a SKU&apos;s stockout share as addressed; a hold counts its overstock share; &quot;no action&quot; counts nothing.
        </p>
      </details>
    </div>
  );
}

const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** The latest things that happened, in plain sentences. */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="text-sm text-mutedtext">Nothing has happened yet. Decisions, orders and alerts appear here as they happen.</p>;
  return (
    <ol className="relative flex flex-col gap-4 border-l-2 border-border pl-5">
      {items.map((a, i) => (
        <li key={`${a.at}-${i}`} className="relative text-sm">
          <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-sapphire" aria-hidden="true" />
          <p className="leading-5 text-sapphire">{a.text}</p>
          <p className="text-xs text-mutedtext">{fmt(a.at)}</p>
        </li>
      ))}
    </ol>
  );
}
