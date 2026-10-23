import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Small building blocks from docs/08-UI-DESIGN-SYSTEM.md. No hooks, so these work in server and client components.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type PillTone = "active" | "quoted" | "expired" | "success" | "danger" | "judgment";

const PILL: Record<PillTone, string> = {
  active: "bg-gold text-sapphire",
  quoted: "bg-sapphire/10 text-sapphire",
  expired: "bg-track/30 text-gray-600",
  // docs/08 says white text; white on emerald is 2.5:1. Sapphire on emerald is 5.6:1 (tests/ui/contrast.test.ts).
  success: "bg-emerald text-sapphire",
  danger: "bg-dangermutedbg text-dangermuted",
  judgment: "border-2 border-gold bg-white text-sapphire",
};

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]", PILL[tone])}>
      {children}
    </span>
  );
}

export function flagTone(flag: string): PillTone {
  if (flag === "STOCKOUT_RISK") return "active";
  if (flag === "HIGH_DEMAND") return "quoted";
  return "expired";
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-card border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(0,45,114,0.05),0_10px_28px_-16px_rgba(0,45,114,0.18)]", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-sapphire">{title}</h2>
      {action}
    </div>
  );
}

/** The top of every page: a small label, the title, one plain sentence, and the page's actions on the right. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <Label>{eyebrow}</Label>}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-sapphire md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm leading-6 text-mutedtext">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A bar for "how far along": always has text beside it, so the colour is never the only signal. */
export function ProgressBar({ value, max, label, tone = "sapphire" }: { value: number; max: number; label: string; tone?: "sapphire" | "emerald" | "gold" }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const fill = tone === "emerald" ? "bg-emerald" : tone === "gold" ? "bg-gold" : "bg-sapphire";
  return (
    <div role="img" aria-label={`${label}: ${value} of ${max}`} className="h-2 w-full overflow-hidden rounded-full bg-track/40">
      <div className={cx("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A round icon badge used at the top of tiles and empty states. Decorative: the words next to it carry the meaning. */
export function IconBadge({ icon: Icon, tone = "sapphire" }: { icon: LucideIcon; tone?: "sapphire" | "gold" | "emerald" }) {
  const t = tone === "gold" ? "bg-gold/20 text-sapphire" : tone === "emerald" ? "bg-emerald/15 text-sapphire" : "bg-sapphire/10 text-sapphire";
  return (
    <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", t)} aria-hidden="true">
      <Icon size={20} />
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mutedtext">{children}</p>;
}

const BUTTON =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-btn px-5 font-bold transition-[transform,opacity] duration-200 ease-in-out hover:scale-[1.02] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100";
export const btnPrimary = cx(BUTTON, "bg-gold text-sapphire");
export const btnSecondary = cx(BUTTON, "border-2 border-sapphire bg-transparent text-sapphire");

export const inputClass =
  "min-h-[44px] w-full rounded-btn border border-border bg-white px-3 text-sapphire disabled:bg-highlight disabled:text-mutedtext";

/** The page's one main landmark. Extra bottom space on phones keeps content clear of the fixed tab bar. */
export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-6 outline-none md:px-8 md:pb-6">
      {children}
    </main>
  );
}

export const linkClass = "font-semibold text-royaltext underline underline-offset-2";

/** What to do next, when a list has nothing in it (docs/07: every list has an empty state). */
export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <Card className="flex flex-col items-start gap-3">
      {icon && <IconBadge icon={icon} />}
      <h2 className="text-lg font-semibold text-sapphire">{title}</h2>
      {children && <p className="max-w-xl text-mutedtext">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </Card>
  );
}

/** A problem the person can act on. Muted terracotta, never vibrant red (G-U1). */
export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-btn bg-dangermutedbg px-4 py-3 text-sm font-semibold text-dangermuted">
      {children}
    </p>
  );
}

/** Placeholder shapes while a page loads. Fades with opacity only; still under reduced motion. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("skeleton rounded-card bg-track/40", className)} />;
}

/** Cover bar: a thin bar showing cover weeks against the allowed band (docs/08, "Cover bar"). */
export function CoverBar({ cover, min, max, flags }: { cover: number; min: number; max: number; flags: string[] }) {
  const scaleMax = Math.max(max * 1.5, cover * 1.1, 1);
  const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;
  const inBand = cover >= min && cover <= max;
  const markerColour = inBand ? "bg-sapphire" : flags.includes("OVERSTOCK_RISK") ? "bg-dangermuted" : "bg-gold";
  return (
    <div className="w-full" role="img" aria-label={`Cover ${cover.toFixed(2)} weeks; allowed ${min} to ${max} weeks`}>
      <div className="relative h-2 rounded-full bg-track/40">
        <div className="absolute inset-y-0 rounded-full bg-sapphire/20" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />
        <div className={cx("absolute -top-1 h-4 w-1.5 rounded-full", markerColour)} style={{ left: `calc(${pct(cover)} - 3px)` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-mutedtext">
        <span>0</span>
        <span>
          band {min} to {max} wk
        </span>
      </div>
    </div>
  );
}
