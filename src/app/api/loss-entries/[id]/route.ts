import { guarded, paramId, readJson } from "@/lib/api/http";
import { updateLossEntry } from "@/lib/workflow/losses";

export const PATCH = guarded("enter_loss", async ({ req, db, user }, params) => {
  return updateLossEntry(db, user, await paramId(params), await readJson(req));
});
