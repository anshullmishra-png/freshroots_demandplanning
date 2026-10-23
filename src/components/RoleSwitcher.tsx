"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { SWITCHABLE_ROLES, switchHref } from "@/lib/auth/switchable";
import { cx } from "@/components/ui";

function RoleLinks({ current, onPick }: { current: Role; onPick?: () => void }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Roles">
      {SWITCHABLE_ROLES.map((r) => (
        <li key={r.role}>
          <a
            href={switchHref(r.role)}
            onClick={onPick}
            aria-current={r.role === current ? "true" : undefined}
            className={cx(
              "flex min-h-[44px] items-center justify-between gap-3 rounded-btn px-3 text-left text-sapphire hover:bg-rowhover",
              r.role === current && "bg-highlight",
            )}
          >
            <span className="leading-tight">
              <span className="block text-sm font-bold">{r.name}</span>
              <span className="block text-xs text-mutedtext">{ROLE_LABELS[r.role]}</span>
            </span>
            {r.role === current && <Check size={16} aria-hidden="true" />}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The whole list, for a page (the phone's Account tab): one tap on a role opens that person's workspace. */
export function RoleList({ current }: { current: Role }) {
  return <RoleLinks current={current} />;
}

/**
 * "Switch role" in the header: one click opens the list, one more signs in as that role and goes to its home page, so
 * nobody signs out and back in. Only drawn on a preview that has open access switched on (see src/lib/auth/demo.ts).
 */
export function RoleSwitcher({ current }: { current: Role }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-btn border border-white/40 px-3 text-sm font-bold text-white hover:bg-white/10"
      >
        Switch role
        <ChevronDown size={16} aria-hidden="true" className={cx(open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-[52px] z-30 w-72 rounded-box border border-border bg-surface p-2 shadow-[0_12px_32px_-12px_rgba(0,45,114,0.45)]">
          <RoleLinks current={current} onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
