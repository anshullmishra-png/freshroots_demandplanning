import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { formatLakhs, formatRupees } from "@/lib/kill/logic";

// Small SVG/HTML charts in the design system's own colours (docs/08). One axis, thin marks, a legend whenever there
// are two series, and the numbers also written as text, so colour is never the only way to read a chart.

/** The data behind a chart, as a table: always one click away (accessibility, and for anyone who wants the figures). */
export function TableView({ summary, head, rows }: { summary: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="min-h-[44px] cursor-pointer py-3 font-semibold text-royaltext">{summary}</summary>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-mutedtext">
              {head.map((h) => (
                <th key={h} className="py-2 pr-4 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                {r.map((c, j) => (
                  <td key={j} className="py-2 pr-4 text-sapphire">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Legend({ items }: { items: Array<{ label: string; className: string }> }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-4 text-xs text-sapphire">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className={cx("h-2.5 w-2.5 rounded-sm", i.className)} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Quarter-to-date loss against the two lines that matter: the alert level and the kill level. */
export function LossBand({ total, alertAbove, killAbove, state }: { total: number; alertAbove: number; killAbove: number; state: "green" | "alert" | "killed" }) {
  const max = Math.max(killAbove * 1.15, total * 1.05);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const fill = state === "killed" ? "bg-dangermuted" : state === "alert" ? "bg-gold" : "bg-emerald";
  return (
    <div role="img" aria-label={`Loss ${formatRupees(total)}. Alert above ${formatRupees(alertAbove)}, kill above ${formatRupees(killAbove)}.`}>
      <div className="relative mt-4 h-3 rounded-full bg-track/40">
        <div className={cx("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: pct(total) }} />
        {/* Two lines only; their labels sit below so they can never run into each other. */}
        <div className="absolute -bottom-1 -top-1 border-l-2 border-dashed border-sapphire" style={{ left: pct(alertAbove) }} />
        <div className="absolute -bottom-1 -top-1 border-l-2 border-solid border-sapphire" style={{ left: pct(killAbove) }} />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-sapphire">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 border-l-2 border-dashed border-sapphire" />
          Alert {formatLakhs(alertAbove).replace("Rs ", "").replace(" lakh", "L")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 border-l-2 border-solid border-sapphire" />
          Kill {formatLakhs(killAbove).replace("Rs ", "").replace(" lakh", "L")}
        </li>
      </ul>
    </div>
  );
}

export interface LossRow {
  label: string;
  stockout: number;
  overstock: number;
}

/** One horizontal bar per loss entry, stockout and overstock side by side with a gap between (2 series: legend always). */
export function LossBars({ rows }: { rows: LossRow[] }) {
  const max = Math.max(...rows.map((r) => r.stockout + r.overstock), 1);
  return (
    <div>
      <Legend items={[{ label: "Stockout lost sales", className: "bg-sapphire" }, { label: "Overstock write-off", className: "bg-gold" }]} />
      <ul className="flex flex-col gap-3" aria-label="Loss per entry">
        {rows.map((r) => {
          const total = r.stockout + r.overstock;
          return (
            <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs">
              <span className="truncate text-mutedtext">{r.label}</span>
              <span className="flex h-3 gap-0.5" role="img" aria-label={`${r.label}: stockout ${formatLakhs(r.stockout)}, overstock ${formatLakhs(r.overstock)}`}>
                <span className="h-full rounded-r-sm bg-sapphire" style={{ width: `${(r.stockout / max) * 100}%` }} />
                <span className="h-full rounded-r-sm bg-gold" style={{ width: `${(r.overstock / max) * 100}%` }} />
              </span>
              <span className="font-bold text-sapphire">{formatLakhs(total).replace("Rs ", "")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface TrendPoint {
  label: string;
  value: number;
}

/** A single line (cumulative reversal rate) against one dashed limit line. */
export function TrendLine({ points, limit, limitLabel }: { points: TrendPoint[]; limit: number; limitLabel: string }) {
  const W = 600;
  const H = 180;
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const top = Math.max(limit * 1.5, ...points.map((p) => p.value), 10);
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = [0, limit, Math.round(top)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Reversal rate over time. Limit ${limit} percent. Latest ${points.at(-1)?.value.toFixed(1) ?? "none"} percent.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-mutedtext text-[10px]">
            {t}%
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(limit)} y2={y(limit)} className="stroke-dangermuted" strokeWidth={1.5} strokeDasharray="5 4" />
      <text x={W - pad.r} y={y(limit) - 5} textAnchor="end" className="fill-dangermuted text-[10px] font-bold">
        {limitLabel}
      </text>
      {points.length > 1 && <polyline fill="none" className="stroke-sapphire" strokeWidth={2} strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />}
      {points.map((p, i) => (
        <circle key={p.label} cx={x(i)} cy={y(p.value)} r={4} className="fill-sapphire stroke-surface" strokeWidth={2}>
          <title>{`${p.label}: ${p.value.toFixed(1)}%`}</title>
        </circle>
      ))}
      {points.length > 0 && (
        <>
          <text x={x(0)} y={H - 6} textAnchor={points.length === 1 ? "middle" : "start"} className="fill-mutedtext text-[10px]">
            {points[0].label}
          </text>
          {points.length > 1 && (
            <text x={x(points.length - 1)} y={H - 6} textAnchor="end" className="fill-mutedtext text-[10px]">
              {points.at(-1)!.label}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

/** Horizontal bars with the count written at the end of each. One series, so no legend. */
export function HBars({ items, format = (n: number) => String(n) }: { items: Array<{ label: string; value: number }>; format?: (n: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs">
          <span className="truncate text-sapphire">{i.label}</span>
          <span className="h-3 rounded-full bg-track/30" role="img" aria-label={`${i.label}: ${format(i.value)}`}>
            <span className="block h-full rounded-full bg-sapphire" style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-bold text-sapphire">{format(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChartCard({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(0,45,114,0.05),0_10px_28px_-16px_rgba(0,45,114,0.18)]">
      <h3 className="text-lg font-semibold text-sapphire">{title}</h3>
      {hint && <p className="mb-4 mt-1 text-sm text-mutedtext">{hint}</p>}
      {children}
    </section>
  );
}
