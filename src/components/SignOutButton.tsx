"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnSecondary, cx } from "@/components/ui";

/** `onDark` is for the sapphire header; elsewhere (the Account page) it is the ordinary outlined button. */
export function SignOutButton({ onDark = false }: { onDark?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={cx(onDark ? "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-btn border border-white/40 px-4 font-bold text-white hover:bg-white/10" : btnSecondary)}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut size={18} aria-hidden="true" />
      <span className="hidden sm:inline">Sign out</span>
      <span className="sm:hidden">Out</span>
    </button>
  );
}
