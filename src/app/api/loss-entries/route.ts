import { guarded, readJson } from "@/lib/api/http";
import { createLossEntry } from "@/lib/workflow/losses";

// Priya's weekly or monthly figures. Saving checks Kill 2 straight away (G-K1).
export const POST = guarded("enter_loss", async ({ req, db, user }) => {
  return Response.json(await createLossEntry(db, user, await readJson(req)), { status: 201 });
});
