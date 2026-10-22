import type { AnyDb } from "@/db/snapshots";
import { auditLog } from "@/db/schema";

export interface AuditEntry {
  actorId: number | null;
  action: string;
  entity: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
}

/** Every state change writes a row with actor and time (guardrail G-M2). The table is append-only in the database. */
export async function writeAuditMany(db: AnyDb, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(auditLog).values(
    entries.map((e) => ({
      actorId: e.actorId,
      action: e.action,
      entity: e.entity,
      entityId: String(e.entityId),
      beforeJson: e.before ?? null,
      afterJson: e.after ?? null,
    })),
  );
}

export function writeAudit(db: AnyDb, entry: AuditEntry): Promise<void> {
  return writeAuditMany(db, [entry]);
}
