import { eq } from "drizzle-orm";
import { buyingDecisions } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { assertCan } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { writeAudit } from "./audit";
import { FINAL_ACTIONS, assertQuantityMatchesAction } from "./review";

export const MIN_AMEND_REASON = 10;

/**
 * A change after review. The review row itself is never edited (it is append-only in the database); the
 * buying decision is amended instead, with a written reason and a before/after audit entry (guardrail G-H6).
 * Only possible while procurement has not placed the order.
 */
export async function amendBuyingDecision(
  db: AnyDb,
  actor: SessionUser,
  buyingDecisionId: number,
  change: { action: unknown; quantity: unknown; reason: unknown },
): Promise<{ id: number; action: string; quantity: number }> {
  assertCan(actor.role, "review");
  const action = change.action;
  const quantity = change.quantity;
  if (typeof action !== "string" || !(FINAL_ACTIONS as readonly string[]).includes(action)) {
    throw badRequest("BAD_ACTION", `action must be one of: ${FINAL_ACTIONS.join(", ")}.`);
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) {
    throw badRequest("BAD_QUANTITY", "quantity must be a whole number, 0 or more.");
  }
  const reason = typeof change.reason === "string" ? change.reason.trim() : "";
  if (reason.length < MIN_AMEND_REASON) {
    throw badRequest("REASON_REQUIRED", `Write a reason of at least ${MIN_AMEND_REASON} characters.`);
  }
  const finalAction = action as (typeof FINAL_ACTIONS)[number];
  assertQuantityMatchesAction(finalAction, quantity);

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(buyingDecisions).where(eq(buyingDecisions.id, buyingDecisionId)).limit(1);
    if (!before) throw notFound(`Buying decision ${buyingDecisionId} does not exist.`);
    if (before.status !== "pending" && before.status !== "held") {
      throw conflict("NOT_AMENDABLE", `A ${before.status} order cannot be changed here.`);
    }
    if (before.action === finalAction && before.quantity === quantity) {
      throw badRequest("NO_CHANGE", "Nothing to change.");
    }
    await tx.update(buyingDecisions).set({ action: finalAction, quantity }).where(eq(buyingDecisions.id, buyingDecisionId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "buying_decision.amended",
      entity: "buying_decision",
      entityId: buyingDecisionId,
      before: { action: before.action, quantity: before.quantity },
      after: { action: finalAction, quantity, reason },
    });
    return { id: buyingDecisionId, action: finalAction, quantity };
  });
}
