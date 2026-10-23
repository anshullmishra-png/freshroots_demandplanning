import { guarded, readJson } from "@/lib/api/http";
import { sendToZoho } from "@/lib/workflow/zoho";

// Procurement sends reviewed orders to Zoho Inventory as draft purchase orders. Nothing is issued from here (G-B3).
export const maxDuration = 60;

export const POST = guarded("mark_placed", async ({ req, db, user }) => {
  const body = (await readJson(req)) as { ids?: unknown } | null;
  return sendToZoho(db, user, body?.ids);
});
