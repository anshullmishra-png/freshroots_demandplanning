import { guarded, paramId, readJson } from "@/lib/api/http";
import { amendBuyingDecision } from "@/lib/workflow/buying";

// A change after review (guardrail G-H6): audited, with a reason. There is deliberately no POST that
// creates a buying decision: they come into being only from a review (G-B1).
export const PATCH = guarded("review", async ({ req, db, user }, params) => {
  const id = await paramId(params);
  const body = (await readJson(req)) as { action?: unknown; quantity?: unknown; reason?: unknown } | null;
  return amendBuyingDecision(db, user, id, { action: body?.action, quantity: body?.quantity, reason: body?.reason });
});
