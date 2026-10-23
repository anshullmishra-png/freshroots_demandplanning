import { and, asc, eq } from "drizzle-orm";
import { emailOutbox } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { redactSecrets } from "@/lib/ai/client";

export interface EmailMessage {
  to: string;
  toName: string;
  subject: string;
  body: string;
}

/** Behind an adapter so the real provider can be chosen later (open question 13). */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Development provider: logs who and what, never the body. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  async send(message: EmailMessage): Promise<void> {
    console.log(`[email:console] to=${message.to} subject="${message.subject}"`);
  }
}

export function getEmailProvider(env: Record<string, string | undefined> = process.env): EmailProvider {
  const name = env.EMAIL_PROVIDER ?? "console";
  if (name === "console") return new ConsoleEmailProvider();
  throw new Error(`EMAIL_PROVIDER "${name}" is not implemented. Use "console" until a provider is chosen (open question 13).`);
}

/**
 * Sends everything queued. Emails are queued in the same transaction as the event that causes them, so an alert is
 * never lost; delivery happens after commit and a failure leaves the row marked failed, never blocking the switch.
 */
export async function deliverQueuedEmails(db: AnyDb, provider: EmailProvider = getEmailProvider()): Promise<{ sent: number; failed: number }> {
  const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "queued")).orderBy(asc(emailOutbox.id)).limit(200);
  let sent = 0;
  let failed = 0;
  for (const row of queued) {
    try {
      await provider.send({ to: row.toEmail, toName: row.toName, subject: row.subject, body: row.body });
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "queued")));
      sent++;
    } catch (e) {
      const message = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300);
      await db.update(emailOutbox).set({ status: "failed", error: message }).where(eq(emailOutbox.id, row.id));
      failed++;
    }
  }
  return { sent, failed };
}

/** Delivery after a transaction has committed. Never throws: the switch has already done its job. */
export async function deliverAfterCommit(db: AnyDb): Promise<void> {
  try {
    await deliverQueuedEmails(db);
  } catch (e) {
    console.error(`[email] delivery failed: ${redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
}
