import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { auditLog, users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { assertCan } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";

export const AUDIT_PAGE_SIZE = 100;

export interface AuditFilters {
  action?: string;
  entity?: string;
  actorId?: number;
  /** YYYY-MM-DD, India time, inclusive. */
  from?: string;
  to?: string;
  page?: number;
}

export interface AuditRow {
  id: number;
  at: Date;
  actor: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The audit log for Deepa and the admin: filterable, newest first, 100 to a page. Read-only. */
export async function getAuditLog(db: AnyDb, actor: SessionUser, filters: AuditFilters = {}) {
  assertCan(actor.role, "view_audit");
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  // The start of an India-time day, as an instant. The offset is cast so Postgres can type the parameter.
  // The ::timestamp matters: without it Postgres reads the date as UTC and shifts the day by 5.5 hours.
  const day = (iso: string, offset: number) => sql`((${iso}::date + ${offset}::int)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
  const where = and(
    filters.action ? eq(auditLog.action, filters.action) : undefined,
    filters.entity ? eq(auditLog.entity, filters.entity) : undefined,
    filters.actorId ? eq(auditLog.actorId, filters.actorId) : undefined,
    filters.from && DATE.test(filters.from) ? gte(auditLog.createdAt, day(filters.from, 0) as never) : undefined,
    filters.to && DATE.test(filters.to) ? lt(auditLog.createdAt, day(filters.to, 1) as never) : undefined,
  );
  const [{ n }] = await db.select({ n: count() }).from(auditLog).where(where);
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.createdAt, actor: users.name, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, before: auditLog.beforeJson, after: auditLog.afterJson })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);
  const actions = (await db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(auditLog.action)).map((a) => a.action);
  const actors = await db.select({ id: users.id, name: users.name }).from(users).orderBy(users.name);
  return { rows: rows as AuditRow[], total: n, page, pages: Math.max(1, Math.ceil(n / AUDIT_PAGE_SIZE)), actions, actors };
}
