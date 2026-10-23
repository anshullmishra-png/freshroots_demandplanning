import { guarded } from "@/lib/api/http";
import { syncFromZoho } from "@/lib/workflow/zoho";

// Asks Zoho which drafts procurement has issued, and marks those orders placed here. Only reads from Zoho.
export const maxDuration = 60;

export const POST = guarded("mark_placed", async ({ db, user }) => syncFromZoho(db, user));
