"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card, CardHeader, btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { formatLakhs, formatRupees } from "@/lib/kill/logic";

export interface LossEntryDto {
  id: number;
  periodStart: string;
  periodEnd: string;
  stockout: number;
  overstock: number;
  note: string | null;
}

interface Saved {
  message: string;
  tone: "ok" | "alert" | "stop";
}

/** Priya's form (docs/07, screen 5). The app never works the figures out: she enters them from her own method. */
export function LossEntryPanel({ entries, quarterLabel, quarterStart, quarterEnd }: { entries: LossEntryDto[]; quarterLabel: string; quarterStart: string; quarterEnd: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<LossEntryDto | null>(null);
  const [start, setStart] = useState(quarterStart);
  const [end, setEnd] = useState(quarterEnd);
  const [stockout, setStockout] = useState("");
  const [overstock, setOverstock] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  const stockoutN = stockout === "" ? NaN : Number(stockout);
  const overstockN = overstock === "" ? NaN : Number(overstock);
  const ready = start !== "" && end !== "" && start <= end && Number.isFinite(stockoutN) && stockoutN >= 0 && Number.isFinite(overstockN) && overstockN >= 0;
  const total = (Number.isFinite(stockoutN) ? stockoutN : 0) + (Number.isFinite(overstockN) ? overstockN : 0);

  function reset() {
    setEditing(null);
    setStart(quarterStart);
    setEnd(quarterEnd);
    setStockout("");
    setOverstock("");
    setNote("");
  }

  function edit(e: LossEntryDto) {
    setEditing(e);
    setStart(e.periodStart);
    setEnd(e.periodEnd);
    setStockout(String(e.stockout));
    setOverstock(String(e.overstock));
    setNote(e.note ?? "");
    setSaved(null);
    setError(null);
  }

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(editing ? `/api/loss-entries/${editing.id}` : "/api/loss-entries", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodStart: start, periodEnd: end, stockoutLossRupees: stockoutN, overstockWriteoffRupees: overstockN, note }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? `Could not save (${res.status}).`);
        return;
      }
      const k = json.kill2 as { state: string; total: number };
      const overlap = (json.overlaps as number[]).length > 0 ? " This period overlaps another entry: check that nothing is counted twice." : "";
      setSaved({
        tone: k.state === "killed" ? "stop" : k.state === "alert" ? "alert" : "ok",
        message:
          (k.state === "killed"
            ? `Saved. Quarter-to-date loss is now ${formatRupees(k.total)}: Kill 2 has stopped the automation.`
            : k.state === "alert"
              ? `Saved. Quarter-to-date loss is now ${formatRupees(k.total)}, above the alert level. An alert was sent.`
              : `Saved. Quarter-to-date loss is now ${formatRupees(k.total)}.`) + overlap,
      });
      reset();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={editing ? `Edit entry for ${editing.periodStart} to ${editing.periodEnd}` : "Enter loss"} />
      <p className="-mt-2 mb-4 text-sm text-mutedtext">
        Figures from your own method, in rupees. One entry covers one period inside {quarterLabel}. Saving checks the alert and kill levels at once.
      </p>
      <form method="post" onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Period start
          <input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Period end
          <input type="date" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Stockout lost sales (Rs)
          <input type="number" inputMode="decimal" min={0} step="0.01" className={inputClass} value={stockout} onChange={(e) => setStockout(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Overstock write-off (Rs)
          <input type="number" inputMode="decimal" min={0} step="0.01" className={inputClass} value={overstock} onChange={(e) => setOverstock(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire md:col-span-2">
          Note (optional)
          <input type="text" maxLength={500} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button type="submit" className={btnPrimary} disabled={!ready || busy}>
            {busy ? "Saving..." : editing ? "Save changes" : "Save entry"}
          </button>
          {editing && (
            <button type="button" className={btnSecondary} onClick={reset} disabled={busy}>
              Cancel edit
            </button>
          )}
          <p className="text-sm text-mutedtext" aria-live="polite">
            Entry total: <span className="font-bold text-sapphire">{formatLakhs(total)}</span> ({formatRupees(total)})
          </p>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-btn bg-dangermutedbg px-4 py-3 text-sm font-semibold text-dangermuted">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className={`mt-4 rounded-btn px-4 py-3 text-sm font-semibold ${saved.tone === "stop" ? "bg-dangermutedbg text-dangermuted" : saved.tone === "alert" ? "bg-gold/20 text-sapphire" : "bg-emerald/15 text-sapphire"}`}>
          {saved.message}
        </p>
      )}

      {entries.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-mutedtext">Entries in {quarterLabel}</p>
          <ul className="divide-y divide-border rounded-box border border-border">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-rowhover">
                <span>
                  <span className="font-bold text-sapphire">
                    {e.periodStart} to {e.periodEnd}
                  </span>
                  <span className="text-mutedtext"> · stockout {formatRupees(e.stockout)} · overstock {formatRupees(e.overstock)}</span>
                  {e.note && <span className="text-mutedtext"> · {e.note}</span>}
                </span>
                <button type="button" className={btnSecondary} onClick={() => edit(e)} aria-label={`Edit entry ${e.periodStart} to ${e.periodEnd}`}>
                  <Pencil size={16} aria-hidden="true" />
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
