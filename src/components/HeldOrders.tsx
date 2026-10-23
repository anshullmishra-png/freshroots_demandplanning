"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card, Label, Pill, btnPrimary, btnSecondary } from "@/components/ui";
import { describeOrder } from "@/lib/orders-shared";
import type { FinalAction } from "@/lib/review-shared";

export interface HeldDto {
  id: number;
  skuId: string;
  skuName: string;
  unit: string;
  action: FinalAction;
  quantity: number;
  runId: number;
}

const MIN = 10;

/** After a kill, held orders wait for Raghav's written confirmation. Nothing is cancelled (docs/06, open question 39). */
export function HeldOrders({ orders }: { orders: HeldDto[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = selected.length > 0 && reason.trim().length >= MIN && !busy;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/orders/release", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selected, reason }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error?.message ?? "Could not release.");
      setBusy(false);
      return;
    }
    setSelected([]);
    setReason("");
    setBusy(false);
    router.refresh();
  }

  return (
    <Card className="border-dangermuted">
      <div className="flex items-start gap-3">
        <AlertTriangle size={22} aria-hidden="true" className="mt-1 shrink-0 text-dangermuted" />
        <div>
          <Label>Held orders waiting for you</Label>
          <h2 className="text-2xl font-semibold text-sapphire">{orders.length} held after automation stopped</h2>
          <p className="mt-1 text-sm text-mutedtext">
            Procurement cannot place these until you confirm each one. They were not cancelled. Confirm only the ones you are sure about, and say why.
          </p>
        </div>
      </div>
      <form method="post" onSubmit={submit} className="mt-4" noValidate>
        <ul className="divide-y divide-border rounded-box border border-border">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm hover:bg-rowhover">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[#002D72]"
                checked={selected.includes(o.id)}
                onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)))}
                aria-label={`Select ${o.skuId}`}
              />
              <span className="min-w-0 flex-1">
                <span className="font-bold text-sapphire">{o.skuId}</span> <span className="text-mutedtext">{o.skuName} · run {o.runId}</span>
              </span>
              <span className="font-semibold text-sapphire">{describeOrder(o.action, o.quantity, o.unit)}</span>
              <Pill tone="danger">held</Pill>
            </li>
          ))}
        </ul>
        <label className="mt-4 flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Your confirmation (at least {MIN} characters)
          <textarea className="min-h-[72px] w-full rounded-btn border border-border bg-white p-3 text-sapphire" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm font-semibold text-dangermuted">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={btnSecondary} onClick={() => setSelected(selected.length === orders.length ? [] : orders.map((o) => o.id))}>
            {selected.length === orders.length ? "Clear selection" : `Select all (${orders.length})`}
          </button>
          <button type="submit" className={btnPrimary} disabled={!ready}>
            <Check size={18} aria-hidden="true" />
            {busy ? "Saving..." : `Confirm ${selected.length} for ordering`}
          </button>
        </div>
      </form>
    </Card>
  );
}
