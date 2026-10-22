"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { btnPrimary, inputClass } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Could not sign in.");
        setBusy(false);
        return;
      }
      router.replace(json.home);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
        Email
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      {error && (
        <p role="alert" className="rounded-btn bg-dangermutedbg px-3 py-2 text-sm font-semibold text-dangermuted">
          {error}
        </p>
      )}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
