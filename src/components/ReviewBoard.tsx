"use client";

import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Card,
  CoverBar,
  Label,
  Pill,
  btnPrimary,
  btnSecondary,
  cx,
  flagTone,
  inputClass,
} from "@/components/ui";
import {
  ACTION_LABELS,
  FINAL_ACTIONS,
  FLAG_LABELS,
  FLAG_TYPES,
  REASON_CODES,
  REASON_LABELS,
  describeDecision,
  type FinalAction,
  type ReviewDataDto,
  type ReviewItemDto,
} from "@/lib/review-shared";

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error?.message ?? `Request failed (${res.status}).`);
  }
}

export function ReviewBoard({ data, canReview }: { data: ReviewDataDto; canReview: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { counts, run } = data;
  const reviewed = counts.accepted + counts.rejected;
  const eligible = data.items.filter((i) => i.status === "pending_review" && !i.needsJudgment && !i.isFallback);

  async function act(id: number, body: unknown) {
    setBusyId(id);
    setError(null);
    try {
      await post("/api/reviews", body);
      setRejectingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the review.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmBulk() {
    setBulkBusy(true);
    setError(null);
    try {
      await post("/api/reviews/bulk-accept", { aiDecisionIds: eligible.map((i) => i.aiDecisionId) });
      setBulkOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept the list.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Label>Run {run.id}</Label>
            <h1 className="text-[32px] font-bold leading-tight text-sapphire">Review AI decisions</h1>
            <p className="mt-1 text-sm text-mutedtext">
              Data as of {run.asOfDate}
              {run.isFestival ? " (festival month, 25% uplift applied)" : ""} · rules {run.rulesVersion}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[32px] font-bold leading-tight text-sapphire">
              {reviewed} of {counts.total}
            </p>
            <p className="text-sm text-mutedtext">reviewed</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Pill tone="quoted">{counts.pending} to review</Pill>
          <Pill tone="success">{counts.accepted} accepted</Pill>
          <Pill tone="danger">{counts.rejected} rejected</Pill>
          {counts.fallback > 0 && <Pill tone="expired">{counts.fallback} AI fallback</Pill>}
          {counts.voided > 0 && <Pill tone="danger">{counts.voided} voided</Pill>}
        </div>
        {run.status === "completed" && (
          <p className="mt-4 rounded-btn bg-highlight px-3 py-2 text-sm font-semibold text-sapphire">
            Every decision in this run has a review. The buying decisions are with procurement.
          </p>
        )}
        {!canReview && (
          <p className="mt-4 rounded-btn bg-highlight px-3 py-2 text-sm text-mutedtext">Read only. Your role cannot accept or reject.</p>
        )}
      </Card>

      {run.fallbackWarning && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-gold bg-gold/15 px-4 py-3 text-sapphire">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
          <p className="text-sm font-semibold">
            More than {data.fallbackWarningPct}% of this run&apos;s decisions are the rule engine&apos;s own answer because the AI was
            unavailable or gave invalid output. Raghav and Deepa should know before relying on this run.
          </p>
        </div>
      )}

      {run.skipped.length > 0 && (
        <Card>
          <Label>Not forecast: handle these yourself</Label>
          <ul className="mt-2 divide-y divide-border">
            {run.skipped.map((s) => (
              <li key={s.sku_id} className="py-2 text-sm">
                <span className="font-bold text-sapphire">{s.sku_id}</span> <span className="text-mutedtext">{s.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {error && (
        <p role="alert" className="rounded-btn bg-dangermutedbg px-4 py-3 text-sm font-semibold text-dangermuted">
          {error}
        </p>
      )}

      {canReview && eligible.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sapphire">{eligible.length} clear decisions</p>
              <p className="text-sm text-mutedtext">Not needs-judgment and not a fallback. You will see the list before anything is accepted.</p>
            </div>
            <button type="button" className={btnSecondary} onClick={() => setBulkOpen((o) => !o)} aria-expanded={bulkOpen}>
              Accept all clear items ({eligible.length})
              <ChevronDown size={18} aria-hidden="true" className={cx("transition-transform duration-200", bulkOpen && "rotate-180")} />
            </button>
          </div>
          {bulkOpen && (
            <div className="mt-4">
              <ul className="divide-y divide-border rounded-box border border-border">
                {eligible.map((i) => (
                  <li key={i.aiDecisionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      <span className="font-bold text-sapphire">{i.skuId}</span> <span className="text-mutedtext">{i.skuName}</span>
                    </span>
                    <span className="font-semibold text-sapphire">{describeDecision(i.action, i.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className={btnPrimary} onClick={confirmBulk} disabled={bulkBusy}>
                  <Check size={18} aria-hidden="true" />
                  {bulkBusy ? "Accepting..." : `Confirm: accept these ${eligible.length}`}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setBulkOpen(false)} disabled={bulkBusy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {data.items.length === 0 ? (
        <Card>
          <p className="text-sapphire">No SKUs were flagged in this run. Nothing to review.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((item) => (
            <li key={item.aiDecisionId}>
              <ItemCard
                item={item}
                canReview={canReview}
                busy={busyId === item.aiDecisionId}
                rejecting={rejectingId === item.aiDecisionId}
                onAccept={() => act(item.aiDecisionId, { aiDecisionId: item.aiDecisionId, outcome: "accepted" })}
                onOpenReject={() => setRejectingId(item.aiDecisionId)}
                onCloseReject={() => setRejectingId(null)}
                onReject={(change) => act(item.aiDecisionId, { aiDecisionId: item.aiDecisionId, outcome: "rejected", change })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemCard(props: {
  item: ReviewItemDto;
  canReview: boolean;
  busy: boolean;
  rejecting: boolean;
  onAccept: () => void;
  onOpenReject: () => void;
  onCloseReject: () => void;
  onReject: (change: RejectChange) => void;
}) {
  const { item, canReview, busy, rejecting } = props;
  const pending = item.status === "pending_review";
  return (
    <article
      className={cx(
        "rounded-card border bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
        // Reviewed items keep full contrast: dimming them with opacity pushed their text below 4.5:1.
        item.needsJudgment && pending ? "border-2 border-gold" : "border-border",
      )}
      aria-label={`${item.skuId} ${item.skuName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-sapphire">
            {item.skuId} <span className="font-normal text-mutedtext">{item.skuName}</span>
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.flagTypes.map((f) => (
              <Pill key={f} tone={flagTone(f)}>
                {FLAG_LABELS[f] ?? f}
              </Pill>
            ))}
            {item.needsJudgment && (
              <Pill tone="judgment">
                <AlertTriangle size={12} aria-hidden="true" className="mr-1" />
                Needs judgment
              </Pill>
            )}
            {item.isFallback && <Pill tone="expired">AI unavailable: rule-engine fallback</Pill>}
            {item.confidence && <Pill tone={item.confidence === "LOW" ? "judgment" : "quoted"}>{item.confidence.toLowerCase()} confidence</Pill>}
          </div>
        </div>
        <ReviewStatus item={item} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="rounded-box bg-highlight p-4">
          <Label>{pending ? "AI decision, pending your review" : "AI decision"}</Label>
          <p className="mt-1 text-2xl font-bold text-sapphire">{describeDecision(item.action, item.quantity)}</p>
          <div className="mt-3">
            <CoverBar cover={item.coverWeeks} min={item.minCover} max={item.maxCover} flags={item.flagTypes} />
          </div>
          <p className="mt-2 text-xs text-mutedtext">
            {item.unitsOnHand} on hand · {item.coverWeeks.toFixed(2)} weeks of cover · demand ratio {item.demandRatio.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-sm leading-6 text-sapphire">{item.explanation}</p>
          {item.needsJudgment && (
            <ul className="mt-2 list-disc pl-5 text-sm text-mutedtext">
              {item.judgmentReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {item.judgmentNote && <li>{item.judgmentNote}</li>}
            </ul>
          )}
        </div>
      </div>

      {pending && canReview && !rejecting && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={btnPrimary} onClick={props.onAccept} disabled={busy}>
            <Check size={18} aria-hidden="true" />
            Accept
          </button>
          <button type="button" className={btnSecondary} onClick={props.onOpenReject} disabled={busy}>
            <X size={18} aria-hidden="true" />
            Reject
          </button>
        </div>
      )}
      {pending && canReview && rejecting && (
        <RejectPanel item={item} busy={busy} onCancel={props.onCloseReject} onSave={props.onReject} />
      )}
    </article>
  );
}

function ReviewStatus({ item }: { item: ReviewItemDto }) {
  if (item.status === "voided_by_kill") return <Pill tone="danger">Voided: automation stopped</Pill>;
  if (!item.review) return <Pill tone="quoted">Pending review</Pill>;
  const r = item.review;
  return (
    <div className="text-right">
      <Pill tone={r.outcome === "accepted" ? "success" : "danger"}>{r.outcome === "accepted" ? "Accepted" : "Rejected"}</Pill>
      {r.outcome === "rejected" && (
        <p className="mt-2 text-sm text-sapphire">
          Changed to <span className="font-bold">{describeDecision(r.finalAction, r.finalQty)}</span>
          <br />
          <span className="text-mutedtext">
            {REASON_LABELS[r.reasonCode as keyof typeof REASON_LABELS] ?? r.reasonCode}
            {r.reasonText ? `: ${r.reasonText}` : ""}
          </span>
        </p>
      )}
    </div>
  );
}

interface RejectChange {
  flagTypes: string[];
  action: FinalAction;
  quantity: number;
  reasonCode: string;
  reasonText: string;
}

/**
 * Raghav changes the flag and the decision for this item and says why. He never edits rules here (G-H3).
 * Save stays disabled until the action or quantity differs from the AI's and a reason is given (G-H2).
 */
function RejectPanel({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: ReviewItemDto;
  busy: boolean;
  onCancel: () => void;
  onSave: (change: RejectChange) => void;
}) {
  const [flagTypes, setFlagTypes] = useState<string[]>(item.flagTypes);
  const [action, setAction] = useState<FinalAction>(item.action);
  const [quantity, setQuantity] = useState<number>(item.quantity);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");

  const qty = action === "REORDER" ? quantity : 0;
  const quantityOk = action !== "REORDER" || (Number.isInteger(qty) && qty >= 1);
  const changed = action !== item.action || qty !== item.quantity;
  const reasonOk = reasonCode !== "" && (reasonCode !== "OTHER" || reasonText.trim() !== "");
  const canSave = changed && quantityOk && reasonOk && !busy;

  let hint: string | null = null;
  if (!changed) hint = "Change the action or the quantity. If you agree with the decision, accept it instead.";
  else if (!quantityOk) hint = "A reorder needs a quantity of at least 1.";
  else if (reasonCode === "") hint = "Pick a reason.";
  else if (!reasonOk) hint = "Write a short explanation for Other.";

  function changeAction(next: FinalAction) {
    setAction(next);
    if (next === "REORDER") setQuantity(item.action === "REORDER" ? item.quantity : item.standardQty);
  }

  return (
    <div className="mt-4 rounded-box border border-border bg-highlight p-4" role="group" aria-label={`Reject ${item.skuId}`}>
      <p className="mb-3 text-sm font-bold text-sapphire">Change the flag and the decision for {item.skuId}</p>

      <fieldset className="mb-4">
        <legend className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-mutedtext">Flags (none checked means no flag)</legend>
        <div className="flex flex-wrap gap-4">
          {FLAG_TYPES.map((f) => (
            <label key={f} className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-sapphire">
              <input
                type="checkbox"
                className="h-5 w-5 accent-sapphire"
                checked={flagTypes.includes(f)}
                onChange={(e) => setFlagTypes((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))}
              />
              {FLAG_LABELS[f]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Action
          <select className={inputClass} value={action} onChange={(e) => changeAction(e.target.value as FinalAction)}>
            {FINAL_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Quantity (units)
          <input
            type="number"
            min={0}
            step={1}
            className={inputClass}
            value={action === "REORDER" ? quantity : 0}
            disabled={action !== "REORDER"}
            onChange={(e) => setQuantity(e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-sapphire">
          Reason
          <select className={inputClass} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            <option value="">Choose a reason</option>
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {REASON_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1 text-sm font-semibold text-sapphire">
        {reasonCode === "OTHER" ? "Explain (required)" : "Note (optional)"}
        <textarea
          className="min-h-[88px] w-full rounded-btn border border-border bg-white p-3 text-sapphire"
          maxLength={1000}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
        />
      </label>

      {hint && <p className="mt-3 text-sm text-mutedtext">{hint}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={btnPrimary}
          disabled={!canSave}
          onClick={() => onSave({ flagTypes, action, quantity: qty, reasonCode, reasonText })}
        >
          {busy ? "Saving..." : "Save rejection"}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
