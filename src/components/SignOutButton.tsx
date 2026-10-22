"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnSecondary } from "@/components/ui";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={btnSecondary}
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
