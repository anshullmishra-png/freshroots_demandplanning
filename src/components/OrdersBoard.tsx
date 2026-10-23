"use client";

import { AlertTriangle, Check, Download, PackageSearch, PlugZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card, EmptyState, IconBadge, Label, Pill, btnPrimary, btnSecondary, cx, inputClass, type PillTone } from "@/components/ui";
import { HELD_MESSAGE, describeOrder, type OrderDto, type OrderStatus, type OrdersDto } from "@/lib/orders-shared";
import { REASON_LABELS, describeDecision } from "@/lib/review-shared";

type Filter = OrderStatus | "all";
const TABS: Array<{ id: Filter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "held", label: "Held" },
  { id: "placed", label: "Placed" },
  { id: "all", label: "All" },
];
const STATUS_TONE: Record<OrderStatus, PillTone> = { pending: "quoted", placed: "expired", held: "danger", cancelled: "expired" };

async function placeOrders(ids: number[], orderReference: string): Promise<void> {
  const res = await fetch("/api/orders/place", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, orderReference }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error?.message ?? `Request failed (${res.status}).`);
  }
}

export function OrdersBoard({ data, canPlace, canExport }: { data: OrdersDto; canPlace: boolean; canExport: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending");
  const [selected, setSelected] = useState<number[]>([]);
  const [sharedRef, setSharedRef] = useState("");
  const [busy, setBusy] = useState<number | "bulk" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => data.orders.filter((o) => filter === "all" || o.status === filter), [data.orders, filter]);
  const pendingShown = shown.filter((o) => o.status === "pending");
  const total = data.counts.pending + data.counts.held + data.counts.placed + data.counts.cancelled;

  async function run(key: number | "bulk", ids: number[], reference: string) {
    setBusy(key);
    setError(null);
    try {
      await placeOrders(ids, reference);
      setSelected([]);
      setSharedRef("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card className="border-l-4 border-l-gold">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Label>Procurement</Label>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-sapphire md:text-[32px]">Orders</h1>
            <p className="mt-1 text-sm text-mutedtext">Every decision here has been reviewed by Raghav. You place the orders; this screen records that you did.</p>
          </div>
          {canExport && (
            <a className={btnSecondary} href={`/api/orders/export?status=${filter}`} download>
              <Download size={18} aria-hidden="true" />
              Export CSV ({filter === "all" ? total : data.counts[filter]})
            </a>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Pill tone="quoted">{data.counts.pending} pending</Pill>
          {data.counts.held > 0 && <Pill tone="danger">{data.counts.held} held</Pill>}
          <Pill tone="expired">{data.counts.placed} placed</Pill>
        </div>
      </Card>

      {data.counts.held > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-dangermuted bg-dangermutedbg px-4 py-3 text-dangermuted">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
          <p className="text-sm font-semibold">{HELD_MESSAGE}</p>
        </div>
      )}

      <Card className="border-dashed">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconBadge icon={PlugZap} />
            <div>
              <Label>Zoho Inventory</Label>
              <p className="text-sm text-sapphire">Not connected. Export the CSV and enter the orders yourself for now.</p>
            </div>
          </div>
          <Pill tone="expired">Not connected</Pill>
        </div>
      </Card>

      <div role="tablist" aria-label="Order status" className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const n = t.id === "all" ? total : data.counts[t.id];
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={filter === t.id}
              onClick={() => {
                setFilter(t.id);
                setSelected([]);
              }}
              className={cx(
                "min-h-[44px] rounded-full px-4 text-sm font-bold transition-[transform,opacity] duration-200 ease-in-out",
                filter === t.id ? "bg-sapphire text-white" : "border border-border bg-surface text-sapphire hover:bg-rowhover",
              )}
            >
              {t.label} ({n})
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="rounded-btn bg-dangermutedbg px-4 py-3 text-sm font-semibold text-dangermuted">
          {error}
        </p>
      )}

      {canPlace && pendingShown.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm font-semibold text-sapphire">
              Order reference for the selected (optional)
              <input className={inputClass} value={sharedRef} maxLength={100} onChange={(e) => setSharedRef(e.target.value)} placeholder="For example the PO number" />
            </label>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setSelected(selected.length === pendingShown.length ? [] : pendingShown.map((o) => o.id))}
            >
              {selected.length === pendingShown.length ? "Clear selection" : `Select all pending (${pendingShown.length})`}
            </button>
            <button type="button" className={btnPrimary} disabled={selected.length === 0 || busy !== null} onClick={() => run("bulk", selected, sharedRef)}>
              <Check size={18} aria-hidden="true" />
              {busy === "bulk" ? "Saving..." : `Mark ${selected.length} selected as placed`}
            </button>
          </div>
        </Card>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={PackageSearch} title={total === 0 ? "No orders yet" : `Nothing ${filter === "all" ? "here" : filter}`}>
          {total === 0 ? "They appear here after Raghav has reviewed a run. Each order is a decision a person has already approved." : "Try another tab."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {shown.map((o) => (
            <li key={o.id}>
              <OrderCard
                order={o}
                canPlace={canPlace}
                selected={selected.includes(o.id)}
                busy={busy === o.id}
                onToggle={() => setSelected((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]))}
                onPlace={(reference) => run(o.id, [o.id], reference)}
              />
            </li>
          ))}
        </ul>
      )}

      {data.noOrderNeeded.length > 0 && (
        <Card>
          <Label>Reviewed, no order needed ({data.noOrderNeeded.length})</Label>
          <ul className="mt-2 divide-y divide-border">
            {data.noOrderNeeded.map((o) => (
              <li key={o.id} className="py-2 text-sm text-sapphire">
                <span className="font-bold">{o.skuId}</span> <span className="text-mutedtext">{o.skuName}</span>
                {o.reasonCode && <span className="text-mutedtext"> · {REASON_LABELS[o.reasonCode as keyof typeof REASON_LABELS] ?? o.reasonCode}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function OrderCard({
  order: o,
  canPlace,
  selected,
  busy,
  onToggle,
  onPlace,
}: {
  order: OrderDto;
  canPlace: boolean;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onPlace: (reference: string) => void;
}) {
  const [reference, setReference] = useState("");
  const isHold = o.action === "PAUSE_ORDER";
  const changed = o.source === "raghav_changed";
  return (
    <article
      className={cx(
        "rounded-card border border-l-4 bg-surface p-5 shadow-[0_1px_2px_rgba(0,45,114,0.05),0_10px_28px_-16px_rgba(0,45,114,0.18)]",
        o.status === "held" ? "border-border border-l-dangermuted" : o.status === "placed" ? "border-border border-l-emerald" : "border-border border-l-sapphire",
      )}
      aria-label={`${o.skuId} ${o.skuName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {canPlace && o.status === "pending" && (
            // The 20px box sits in a 44px square the finger can hit anywhere in.
            <label className="-ml-2 -mt-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
              <input type="checkbox" className="h-5 w-5 accent-sapphire" checked={selected} onChange={onToggle} aria-label={`Select ${o.skuId}`} />
            </label>
          )}
          <div>
            <h3 className="text-sm font-bold text-sapphire">
              {o.skuId} <span className="font-normal text-mutedtext">{o.skuName}</span>
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill tone={changed ? "judgment" : "success"}>{changed ? "Raghav changed" : "AI accepted"}</Pill>
              <Pill tone={STATUS_TONE[o.status]}>{o.status}</Pill>
            </div>
          </div>
        </div>
        <p className="text-right text-xs text-mutedtext">
          Run {o.runId} · {o.runDate}
          <br />
          {o.status === "placed" ? `Placed with data ${o.dataAgeDays} day${o.dataAgeDays === 1 ? "" : "s"} old` : `Data is ${o.dataAgeDays} day${o.dataAgeDays === 1 ? "" : "s"} old`}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-box bg-highlight p-4">
          <Label>{isHold ? "Instruction" : "Order"}</Label>
          <p className="mt-1 text-2xl font-bold text-sapphire">{describeOrder(o.action, o.quantity, o.unit)}</p>
          {isHold && <p className="mt-1 text-xs text-mutedtext">Do not cancel any order already placed.</p>}
        </div>
        <div className="text-sm text-sapphire">
          {changed ? (
            <>
              <p>
                AI said <span className="font-bold">{describeDecision(o.aiAction, o.aiQuantity, o.unit)}</span>. Raghav changed it
                {o.reasonCode ? `: ${REASON_LABELS[o.reasonCode as keyof typeof REASON_LABELS] ?? o.reasonCode}` : ""}.
              </p>
              {o.reasonText && <p className="mt-1 text-mutedtext">{o.reasonText}</p>}
            </>
          ) : (
            <p className="text-mutedtext">The AI decision was accepted as it was.</p>
          )}
          {o.status === "placed" && (
            <p className="mt-2">
              Placed by <span className="font-bold">{o.placedBy ?? "procurement"}</span>
              {o.orderReference ? <> · reference <span className="font-bold">{o.orderReference}</span></> : null}
            </p>
          )}
        </div>
      </div>

      {o.status === "held" && <p className="mt-3 text-sm font-semibold text-dangermuted">{HELD_MESSAGE}</p>}

      {canPlace && o.status === "pending" && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-semibold text-sapphire">
            Order reference (optional)
            <input className={inputClass} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
          </label>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => onPlace(reference)}>
            <Check size={18} aria-hidden="true" />
            {busy ? "Saving..." : isHold ? "Confirm hold" : "Mark placed"}
          </button>
        </div>
      )}
    </article>
  );
}
