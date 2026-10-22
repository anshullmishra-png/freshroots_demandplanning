import { createHash, timingSafeEqual } from "node:crypto";
import { unauthorized } from "@/lib/errors";

const MIN_SECRET_LENGTH = 16;

/**
 * The scheduled job proves itself with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this). It fails
 * closed: no secret configured, or a short one, means nobody gets in. The comparison does not leak where it differs.
 */
export function assertCronSecret(req: Request, env: Record<string, string | undefined> = process.env): void {
  const secret = env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || secret.length < MIN_SECRET_LENGTH || given === "") throw unauthorized("Invalid cron secret.");
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!timingSafeEqual(a, b)) throw unauthorized("Invalid cron secret.");
}
