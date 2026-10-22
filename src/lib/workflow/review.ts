import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { aiDecisions, buyingDecisions, flags, reviews, runs, skus } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { assertCan, isBreakGlass } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { FINAL_ACTIONS, FLAG_TYPES, REASON_CODES, type FinalAction, type ReasonCode } from "@/lib/review-shared";
import { deliverAfterCommit } from "@/lib/email";
import { evaluateKill1AndAct } from "@/lib/kill/service";
import { writeAudit, writeAuditMany } from "./audit";

export { FLAG_TYPES, FINAL_ACTIONS, REASON_CODES };

export interface RejectionChange {
  flagTypes: string[];
  action: FinalAction;
  quantity: number;
  reasonCode: ReasonCode;
  reasonText: string | null;
}

export type ReviewRequest =
  | { aiDecisionId: number; outcome: "accepted" }
  | { aiDecisionId: number; outcome: "rejected"; change: RejectionChange };

export const MAX_BULK = 500;

/** Checks the shape of a review request from the outside world. Everything after this trusts the types. */
export function parseReviewRequest(body: unknown): ReviewRequest {
  if (typeof body !== "object" || body === null) throw badRequest("BAD_BODY", "Send a JSON object.");
  const b = body as Record<string, unknown>;
  const id = b.aiDecisionId;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw badRequest("BAD_DECISION_ID", "aiDecisionId must be a positive whole number.");
  }
  if (b.outcome === "accepted") return { aiDecisionId: id, outcome: "accepted" };
  if (b.outcome !== "rejected") throw badRequest("BAD_OUTCOME", 'outcome must be "accepted" or "rejected".');

  const c = b.change;
  if (typeof c !== "object" || c === null) {
    throw badRequest("CHANGE_REQUIRED", "A rejection must say what the flag and decision should be.");
  }
  const ch = c as Record<string, unknown>;
  // A rejection cannot be saved without a reason code (guardrail G-H2).
  if (typeof ch.reasonCode !== "string" || !(REASON_CODES as readonly string[]).includes(ch.reasonCode)) {
    throw badRequest("REASON_REQUIRED", `A reason code is required: ${REASON_CODES.join(", ")}.`);
  }
  const reasonText = typeof ch.reasonText === "string" && ch.reasonText.trim() !== "" ? ch.reasonText.trim() : null;
  if (reasonText !== null && reasonText.length > 1000) throw badRequest("REASON_TOO_LONG", "reasonText is at most 1000 characters.");
  if (ch.reasonCode === "OTHER" && reasonText === null) {
    throw badRequest("REASON_TEXT_REQUIRED", "Write a reason when the code is OTHER.");
  }
  if (!Array.isArray(ch.flagTypes) || ch.flagTypes.some((f) => !(FLAG_TYPES as readonly unknown[]).includes(f))) {
    throw badRequest("BAD_FLAGS", `flagTypes must be a list of: ${FLAG_TYPES.join(", ")} (empty for none).`);
  }
  const flagTypes = [...new Set(ch.flagTypes as string[])];
  if (typeof ch.action !== "string" || !(FINAL_ACTIONS as readonly string[]).includes(ch.action)) {
    throw badRequest("BAD_ACTION", `action must be one of: ${FINAL_ACTIONS.join(", ")}.`);
  }
  if (typeof ch.quantity !== "number" || !Number.isInteger(ch.quantity) || ch.quantity < 0) {
    throw badRequest("BAD_QUANTITY", "quantity must be a whole number, 0 or more.");
  }
  return {
    aiDecisionId: id,
    outcome: "rejected",
    change: {
      flagTypes,
      action: ch.action as FinalAction,
      quantity: ch.quantity,
      reasonCode: ch.reasonCode as ReasonCode,
      reasonText,
    },
  };
}

/** Quantity must be positive for REORDER and zero otherwise, whoever sets it (guardrail G-B5). */
export function assertQuantityMatchesAction(action: FinalAction, quantity: number): void {
  if (action === "REORDER" && quantity <= 0) {
    throw badRequest("BAD_QUANTITY", "A REORDER needs a quantity of at least 1.");
  }
  if (action !== "REORDER" && quantity !== 0) {
    throw badRequest("BAD_QUANTITY", `${action} must have quantity 0.`);
  }
}

export interface ReviewResult {
  reviewId: number;
  buyingDecisionId: number;
  aiDecisionId: number;
  outcome: "accepted" | "rejected";
  finalAction: FinalAction;
  finalQty: number;
  runId: number;
  runCompleted: boolean;
  /** This review made a kill switch fire. Everything unreviewed was voided and unplaced orders were held. */
  kill1Fired?: boolean;
}

/**
 * One human review: accept or reject-and-change. Only Raghav (or an audited admin) may call this (G-H7).
 * It is the only way a buying decision comes into being (G-B1), it writes an append-only review row (G-H6)
 * and it never auto-approves anything (G-H1).
 */
export async function reviewDecision(db: AnyDb, actor: SessionUser, request: ReviewRequest): Promise<ReviewResult> {
  assertCan(actor.role, "review");
  // Kill 1 is checked in the same transaction as the review, so the count it sees includes this review (G-K1).
  const result = await db.transaction(async (tx) => {
    const reviewed = await applyReview(tx, actor, request);
    const kill = await evaluateKill1AndAct(tx);
    return { ...reviewed, kill1Fired: kill.fired };
  });
  if (result.kill1Fired) await deliverAfterCommit(db);
  return result;
}

async function applyReview(tx: AnyDb, actor: SessionUser, request: ReviewRequest): Promise<ReviewResult> {
  // Claim the decision atomically: only one review can ever win, and a voided decision can never be reviewed.
  const [claimed] = await tx
    .update(aiDecisions)
    .set({ status: "reviewed" })
    .where(and(eq(aiDecisions.id, request.aiDecisionId), eq(aiDecisions.status, "pending_review")))
    .returning();
  if (!claimed) {
    const [existing] = await tx.select({ status: aiDecisions.status }).from(aiDecisions).where(eq(aiDecisions.id, request.aiDecisionId)).limit(1);
    if (!existing) throw notFound(`AI decision ${request.aiDecisionId} does not exist.`);
    if (existing.status === "voided_by_kill") throw conflict("DECISION_VOIDED", "Automation was stopped; this decision was voided and cannot be reviewed.");
    throw conflict("ALREADY_REVIEWED", "This decision has already been reviewed.");
  }
  const [flag] = await tx.select().from(flags).where(eq(flags.id, claimed.flagId)).limit(1);

  let finalAction: FinalAction;
  let finalQty: number;
  let finalFlags: string[];
  let reasonCode: ReasonCode | null = null;
  let reasonText: string | null = null;
  if (request.outcome === "accepted") {
    finalAction = claimed.action;
    finalQty = claimed.quantity;
    finalFlags = flag.flagTypes;
  } else {
    const c = request.change;
    assertQuantityMatchesAction(c.action, c.quantity);
    // A rejection is a reversal: the final action or quantity must differ from the AI's (open question 6).
    if (c.action === claimed.action && c.quantity === claimed.quantity) {
      throw badRequest(
        "NO_CHANGE",
        "A rejection must change the action or the quantity. If you agree with the decision, accept it.",
      );
    }
    finalAction = c.action;
    finalQty = c.quantity;
    finalFlags = c.flagTypes;
    reasonCode = c.reasonCode;
    reasonText = c.reasonText;
  }

  const [review] = await tx
    .insert(reviews)
    .values({
      aiDecisionId: claimed.id,
      reviewerId: actor.id,
      outcome: request.outcome,
      finalAction,
      finalQty,
      finalFlagTypes: finalFlags,
      reasonCode,
      reasonText,
    })
    .returning({ id: reviews.id });

  const [buying] = await tx
    .insert(buyingDecisions)
    .values({ reviewId: review.id, skuId: flag.skuId, action: finalAction, quantity: finalQty })
    .returning({ id: buyingDecisions.id });

  await writeAudit(tx, {
    actorId: actor.id,
    action: request.outcome === "accepted" ? "review.accepted" : "review.rejected",
    entity: "ai_decision",
    entityId: claimed.id,
    before: { action: claimed.action, quantity: claimed.quantity, flags: flag.flagTypes },
    after: { action: finalAction, quantity: finalQty, flags: finalFlags, reasonCode, reasonText, buyingDecisionId: buying.id },
  });
  if (isBreakGlass(actor.role, "review")) {
    await writeAudit(tx, {
      actorId: actor.id,
      action: "review.break_glass",
      entity: "ai_decision",
      entityId: claimed.id,
      after: { by: actor.email, role: actor.role },
    });
  }

  // The run completes when every decision in it has a review.
  const [{ n: pending }] = await tx
    .select({ n: count() })
    .from(aiDecisions)
    .innerJoin(flags, eq(flags.id, aiDecisions.flagId))
    .where(and(eq(flags.runId, flag.runId), eq(aiDecisions.status, "pending_review")));
  let runCompleted = false;
  if (pending === 0) {
    const done = await tx
      .update(runs)
      .set({ status: "completed" })
      .where(and(eq(runs.id, flag.runId), eq(runs.status, "in_review")))
      .returning({ id: runs.id });
    runCompleted = done.length > 0;
  }

  return {
    reviewId: review.id,
    buyingDecisionId: buying.id,
    aiDecisionId: claimed.id,
    outcome: request.outcome,
    finalAction,
    finalQty,
    runId: flag.runId,
    runCompleted,
  };
}

/**
 * Accepts many decisions at once. Allowed only when every one is a plain AI decision: not needs-judgment,
 * not a fallback (G-H4, G-H5). If any is not eligible, nothing is accepted. All or nothing.
 */
export async function bulkAccept(db: AnyDb, actor: SessionUser, aiDecisionIds: unknown): Promise<ReviewResult[]> {
  assertCan(actor.role, "review");
  if (!Array.isArray(aiDecisionIds) || aiDecisionIds.length === 0 || aiDecisionIds.length > MAX_BULK) {
    throw badRequest("BAD_IDS", `Send between 1 and ${MAX_BULK} decision ids.`);
  }
  if (aiDecisionIds.some((i) => typeof i !== "number" || !Number.isInteger(i) || i <= 0)) {
    throw badRequest("BAD_IDS", "Every id must be a positive whole number.");
  }
  const ids = [...new Set(aiDecisionIds as number[])];

  const results = await db.transaction(async (tx) => {
    const found = await tx
      .select({
        id: aiDecisions.id,
        status: aiDecisions.status,
        needsJudgment: aiDecisions.needsJudgment,
        isFallback: aiDecisions.isFallback,
        skuId: flags.skuId,
      })
      .from(aiDecisions)
      .innerJoin(flags, eq(flags.id, aiDecisions.flagId))
      .where(inArray(aiDecisions.id, ids));
    const missing = ids.filter((i) => !found.some((f) => f.id === i));
    if (missing.length) throw notFound(`AI decisions not found: ${missing.join(", ")}.`);

    const notPending = found.filter((f) => f.status !== "pending_review");
    if (notPending.length) {
      throw conflict("NOT_PENDING", `Already reviewed or voided: ${notPending.map((f) => f.skuId).join(", ")}.`);
    }
    const ineligible = found.filter((f) => f.needsJudgment || f.isFallback);
    if (ineligible.length) {
      throw badRequest(
        "BULK_NOT_ALLOWED",
        "Needs-judgment and fallback decisions cannot be bulk-accepted. Review them one by one.",
        ineligible.map((f) => ({ aiDecisionId: f.id, sku: f.skuId, needsJudgment: f.needsJudgment, isFallback: f.isFallback })),
      );
    }
    const accepted = await applyAcceptBatch(tx, actor, ids);
    // Accepting raises the number reviewed, which can lift a run past the minimum sample, so check once at the end.
    const kill = await evaluateKill1AndAct(tx);
    return accepted.map((r) => ({ ...r, kill1Fired: kill.fired }));
  });
  if (results.some((r) => r.kill1Fired)) await deliverAfterCommit(db);
  return results;
}

/**
 * The accept path for many decisions, with one query per step instead of several per decision. A bulk accept of
 * a whole run must stay fast against a remote database. Same rules and same rows as `applyReview` accepting each.
 */
async function applyAcceptBatch(tx: AnyDb, actor: SessionUser, ids: number[]): Promise<ReviewResult[]> {
  const claimed = await tx
    .update(aiDecisions)
    .set({ status: "reviewed" })
    .where(and(inArray(aiDecisions.id, ids), eq(aiDecisions.status, "pending_review")))
    .returning();
  if (claimed.length !== ids.length) {
    throw conflict("NOT_PENDING", "Some decisions were reviewed by someone else while you were working. Reload and try again.");
  }
  const flagRows = await tx.select().from(flags).where(inArray(flags.id, claimed.map((c) => c.flagId)));
  const flagById = new Map(flagRows.map((f) => [f.id, f]));

  const inserted = await tx
    .insert(reviews)
    .values(
      claimed.map((c) => ({
        aiDecisionId: c.id,
        reviewerId: actor.id,
        outcome: "accepted" as const,
        finalAction: c.action,
        finalQty: c.quantity,
        finalFlagTypes: flagById.get(c.flagId)!.flagTypes,
      })),
    )
    .returning({ id: reviews.id, aiDecisionId: reviews.aiDecisionId });
  const reviewIdByDecision = new Map(inserted.map((r) => [r.aiDecisionId, r.id]));

  const bought = await tx
    .insert(buyingDecisions)
    .values(
      claimed.map((c) => ({
        reviewId: reviewIdByDecision.get(c.id)!,
        skuId: flagById.get(c.flagId)!.skuId,
        action: c.action,
        quantity: c.quantity,
      })),
    )
    .returning({ id: buyingDecisions.id, reviewId: buyingDecisions.reviewId });
  const buyingIdByReview = new Map(bought.map((b) => [b.reviewId, b.id]));

  const breakGlass = isBreakGlass(actor.role, "review");
  await writeAuditMany(
    tx,
    claimed.flatMap((c) => {
      const flag = flagById.get(c.flagId)!;
      const reviewId = reviewIdByDecision.get(c.id)!;
      return [
        {
          actorId: actor.id,
          action: "review.accepted",
          entity: "ai_decision",
          entityId: c.id,
          before: { action: c.action, quantity: c.quantity, flags: flag.flagTypes },
          after: { action: c.action, quantity: c.quantity, flags: flag.flagTypes, reasonCode: null, reasonText: null, buyingDecisionId: buyingIdByReview.get(reviewId) },
        },
        ...(breakGlass ? [{ actorId: actor.id, action: "review.break_glass", entity: "ai_decision", entityId: c.id, after: { by: actor.email, role: actor.role } }] : []),
      ];
    }),
  );

  // Complete every run that has no pending decision left.
  const runIds = [...new Set(flagRows.map((f) => f.runId))];
  const completed = new Set<number>();
  for (const runId of runIds) {
    const [{ n: pending }] = await tx
      .select({ n: count() })
      .from(aiDecisions)
      .innerJoin(flags, eq(flags.id, aiDecisions.flagId))
      .where(and(eq(flags.runId, runId), eq(aiDecisions.status, "pending_review")));
    if (pending === 0) {
      const done = await tx.update(runs).set({ status: "completed" }).where(and(eq(runs.id, runId), eq(runs.status, "in_review"))).returning({ id: runs.id });
      if (done.length > 0) completed.add(runId);
    }
  }

  const byId = new Map(claimed.map((c) => [c.id, c]));
  return ids.map((id) => {
    const c = byId.get(id)!;
    const reviewId = reviewIdByDecision.get(id)!;
    const runId = flagById.get(c.flagId)!.runId;
    return {
      reviewId,
      buyingDecisionId: buyingIdByReview.get(reviewId)!,
      aiDecisionId: id,
      outcome: "accepted" as const,
      finalAction: c.action,
      finalQty: c.quantity,
      runId,
      runCompleted: completed.has(runId),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Read model for the Review page.

export interface ReviewItem {
  aiDecisionId: number;
  skuId: string;
  skuName: string;
  perishability: "Low" | "High";
  flagTypes: string[];
  coverWeeks: number;
  minCover: number;
  maxCover: number;
  demandRatio: number;
  unitsOnHand: number;
  standardQty: number;
  ruleAction: "REORDER" | "PAUSE_ORDER";
  ruleQty: number;
  action: "REORDER" | "PAUSE_ORDER";
  quantity: number;
  explanation: string;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  needsJudgment: boolean;
  judgmentNote: string | null;
  judgmentReasons: string[];
  isFallback: boolean;
  status: "pending_review" | "reviewed" | "voided_by_kill";
  review: null | {
    outcome: "accepted" | "rejected";
    finalAction: FinalAction;
    finalQty: number;
    finalFlagTypes: string[];
    reasonCode: string | null;
    reasonText: string | null;
    reviewedAt: Date;
  };
}

export interface ReviewData {
  run: {
    id: number;
    createdAt: Date;
    rulesVersion: string;
    status: string;
    fallbackWarning: boolean;
    asOfDate: string;
    isFestival: boolean;
    skipped: Array<{ sku_id: string; reason: string }>;
  };
  items: ReviewItem[];
  counts: { total: number; pending: number; accepted: number; rejected: number; voided: number; fallback: number };
}

// Priority when sorting: stockout first, then high demand, then overstock (docs/07, screen 3).
const FLAG_PRIORITY = ["STOCKOUT_RISK", "HIGH_DEMAND", "OVERSTOCK_RISK"];
const priorityOf = (types: string[]) => Math.min(...types.map((t) => FLAG_PRIORITY.indexOf(t)).filter((i) => i >= 0), 99);

export async function latestRunId(db: AnyDb): Promise<number | null> {
  const [r] = await db.select({ id: runs.id }).from(runs).orderBy(desc(runs.id)).limit(1);
  return r?.id ?? null;
}

export async function getReviewData(db: AnyDb, runId: number): Promise<ReviewData> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound(`Run ${runId} does not exist.`);

  const rows = await db
    .select({ d: aiDecisions, f: flags, s: skus, r: reviews })
    .from(aiDecisions)
    .innerJoin(flags, eq(flags.id, aiDecisions.flagId))
    .innerJoin(skus, eq(skus.skuId, flags.skuId))
    .leftJoin(reviews, eq(reviews.aiDecisionId, aiDecisions.id))
    .where(eq(flags.runId, runId))
    .orderBy(asc(flags.skuId));

  const items: ReviewItem[] = rows.map(({ d, f, s, r }) => ({
    aiDecisionId: d.id,
    skuId: f.skuId,
    skuName: s.name,
    perishability: s.perishability,
    flagTypes: f.flagTypes,
    coverWeeks: f.coverWeeks,
    minCover: f.minCover,
    maxCover: f.maxCover,
    demandRatio: f.demandRatio,
    unitsOnHand: f.unitsOnHand,
    standardQty: f.standardQty,
    ruleAction: f.ruleAction,
    ruleQty: f.ruleQty,
    action: d.action,
    quantity: d.quantity,
    explanation: d.explanation,
    confidence: d.confidence,
    needsJudgment: d.needsJudgment,
    judgmentNote: d.judgmentNote,
    judgmentReasons: f.judgmentReasons,
    isFallback: d.isFallback,
    status: d.status,
    review: r
      ? {
          outcome: r.outcome,
          finalAction: r.finalAction,
          finalQty: r.finalQty,
          finalFlagTypes: r.finalFlagTypes,
          reasonCode: r.reasonCode,
          reasonText: r.reasonText,
          reviewedAt: r.reviewedAt,
        }
      : null,
  }));

  // Pending first; within a group needs-judgment first, then flag priority, then SKU id.
  items.sort((a, b) => {
    const pend = Number(b.status === "pending_review") - Number(a.status === "pending_review");
    if (pend) return pend;
    const nj = Number(b.needsJudgment) - Number(a.needsJudgment);
    if (nj) return nj;
    const p = priorityOf(a.flagTypes) - priorityOf(b.flagTypes);
    if (p) return p;
    return a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0;
  });

  const summary = run.summaryJson as {
    as_of_date: string;
    is_festival: boolean;
    skipped: Array<{ sku_id: string; reason: string }>;
  };
  return {
    run: {
      id: run.id,
      createdAt: run.createdAt,
      rulesVersion: run.rulesVersion,
      status: run.status,
      fallbackWarning: run.fallbackWarning,
      asOfDate: summary.as_of_date,
      isFestival: summary.is_festival,
      skipped: summary.skipped,
    },
    items,
    counts: {
      total: items.length,
      pending: items.filter((i) => i.status === "pending_review").length,
      accepted: items.filter((i) => i.review?.outcome === "accepted").length,
      rejected: items.filter((i) => i.review?.outcome === "rejected").length,
      voided: items.filter((i) => i.status === "voided_by_kill").length,
      fallback: items.filter((i) => i.isFallback).length,
    },
  };
}
