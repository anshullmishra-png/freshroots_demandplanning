"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { btnPrimary } from "@/components/ui";

const MIN_REASON = 20;

async function send(url: string, body?: unknown): Promise<{ ok: boolean; json: { error?: { code?: string; message?: string } } & Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

/** Deepa's weekly "I reviewed this week's alert" (docs/07, screen 6). */
export function AcknowledgeButton({ week }: { week: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className={btnPrimary}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await send("/api/kill/acknowledge");
          if (!r.ok) setError(r.json.error?.message ?? "Could not save.");
          else router.refresh();
          setBusy(false);
        }}
      >
        <Check size={18} aria-hidden="true" />
        {busy ? "Saving..." : "I reviewed this week's alert"}
      </button>
      <p className="mt-2 text-xs text-mutedtext">Recorded for {week}.</p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-dangermuted">
          {error}
        </p>
      )}
    </div>
  );
}

/** Re-arm with a written reason. Kill 2 warns first when the loss is still above the kill level (docs/06). */
export function RearmForm({ which, refireWarning }: { which: 1 | 2; refireWarning: string | null }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const long = reason.trim().length >= MIN_REASON;
  const ready = long && (refireWarning === null || confirm) && !busy;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await send("/api/kill/rearm", { which, reason, confirmRefire: confirm });
    if (!r.ok) {
      setError(r.json.error?.message ?? "Could not re-arm.");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <form method="post" onSubmit={submit} className="mt-4 flex flex-col gap-3 rounded-box bg-highlight p-4" noValidate>
      <p className="text-sm font-bold text-sapphire">Re-arm Kill {which}</p>
      {refireWarning && (
        <p role="alert" className="rounded-btn bg-gold/20 px-3 py-2 text-sm font-semibold text-sapphire">
          {refireWarning}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
        Why is it safe to continue? (at least {MIN_REASON} characters)
        <textarea className="min-h-[88px] w-full rounded-btn border border-border bg-white p-3 text-sapphire" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      </label>
      <p className="text-xs text-mutedtext">
        {reason.trim().length} of {MIN_REASON} characters. {which === 1 ? "Counting restarts from zero. Past reviews are kept." : "Every loss entry is kept."} Voided decisions stay voided and held orders stay held until Raghav confirms them.
      </p>
      {refireWarning && (
        <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold text-sapphire">
          <input type="checkbox" className="h-5 w-5 accent-sapphire" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I understand Kill 2 will fire again on the next check
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-dangermuted">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className={btnPrimary} disabled={!ready}>
          {busy ? "Re-arming..." : `Re-arm Kill ${which}`}
        </button>
      </div>
    </form>
  );
}
