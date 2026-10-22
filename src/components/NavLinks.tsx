"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export function NavLinks({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-6 overflow-x-auto">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap border-b-2 py-[21px] text-sm font-semibold text-sapphire",
              active ? "border-gold" : "border-transparent hover:border-gold/50",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
