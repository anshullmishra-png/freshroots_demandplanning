"use client";

import { ClipboardCheck, LayoutDashboard, Package, ScrollText, Settings, ShieldAlert, Upload, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/review": ClipboardCheck,
  "/orders": Package,
  "/run/new": Upload,
  "/kill": ShieldAlert,
  "/audit": ScrollText,
  "/settings": Settings,
  "/account": User,
};

/**
 * Phones only: a fixed 72px bar with up to four destinations (docs/08, layout). Active is royal, inactive is muted.
 * The label is the darker royal-text colour because small royal text on white is only 3.7:1.
 */
export function BottomTabBar({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main (phone)" className="fixed inset-x-0 bottom-0 z-20 h-[72px] border-t border-border bg-surface md:hidden">
      <ul className="grid h-full" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = ICONS[item.href] ?? LayoutDashboard;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex h-full min-h-[44px] flex-col items-center justify-center gap-1", active ? "text-royaltext" : "text-mutedtext")}
              >
                <Icon size={24} aria-hidden="true" className={active ? "text-royal" : undefined} />
                <span className="text-[9px] font-bold uppercase tracking-wide">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
