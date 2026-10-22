import { guarded } from "@/lib/api/http";
import { acknowledgeAlert } from "@/lib/kill/service";

export const POST = guarded("ack_alert", async ({ db, user }) => acknowledgeAlert(db, user));
