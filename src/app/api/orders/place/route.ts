import { guarded, readJson } from "@/lib/api/http";
import { markPlaced } from "@/lib/workflow/orders";

// Procurement confirms that it placed the order(s). The system never places an order on its own (G-B2).
export const POST = guarded("mark_placed", async ({ req, db, user }) => {
  const body = (await readJson(req)) as { ids?: unknown; orderReference?: unknown } | null;
  return markPlaced(db, user, body?.ids, body?.orderReference);
});
