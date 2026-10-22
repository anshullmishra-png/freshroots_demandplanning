import Link from "next/link";
import { getDb } from "@/db/client";
import { Protected } from "@/components/Shell";
import { Card, Label, btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { getAuditLog, type AuditFilters } from "@/lib/workflow/auditLog";

export const metadata = { title: "Audit log | Freshroots Demand Planning" };

type Params = { action?: string; entity?: string; actor?: string; from?: string; to?: string; page?: string };

const when = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" });
const short = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));

export default function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <Protected
      permission="view_audit"
      render={async (user) => {
        const p = await searchParams;
        const filters: AuditFilters = {
          action: p.action || undefined,
          entity: p.entity || undefined,
          actorId: p.actor ? Number(p.actor) || undefined : undefined,
          from: p.from || undefined,
          to: p.to || undefined,
          page: p.page ? Number(p.page) || 1 : 1,
        };
        const log = await getAuditLog(getDb(), user, filters);
        const link = (page: number) => {
          const q = new URLSearchParams();
          for (const [k, v] of Object.entries(p)) if (v && k !== "page") q.set(k, v);
          q.set("page", String(page));
          return `/audit?${q.toString()}`;
        };
        return (
          <div className="flex flex-col gap-6">
            <div>
              <Label>Audit</Label>
              <h1 className="text-[32px] font-bold leading-tight text-sapphire">Audit log</h1>
              <p className="text-sm text-mutedtext">Every upload, run, review, order, loss entry, kill and re-arm, with who and when. Entries cannot be changed or deleted.</p>
            </div>

            <Card>
              {/* A filter form: it only carries filters, never a password or token, so it may use GET. */}
              <form method="get" action="/audit" data-get-safe="filters only" className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                <label className="flex flex-col gap-1 text-xs font-semibold text-sapphire">
                  Action
                  <select name="action" defaultValue={p.action ?? ""} className={inputClass}>
                    <option value="">Any</option>
                    {log.actions.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-sapphire">
                  Who
                  <select name="actor" defaultValue={p.actor ?? ""} className={inputClass}>
                    <option value="">Anyone</option>
                    {log.actors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-sapphire">
                  Record type
                  <input name="entity" defaultValue={p.entity ?? ""} className={inputClass} placeholder="for example ai_decision" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-sapphire">
                  From
                  <input type="date" name="from" defaultValue={p.from ?? ""} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-sapphire">
                  To
                  <input type="date" name="to" defaultValue={p.to ?? ""} className={inputClass} />
                </label>
                <div className="flex items-end gap-2">
                  <button type="submit" className={btnPrimary}>
                    Filter
                  </button>
                  <Link href="/audit" className={btnSecondary}>
                    Clear
                  </Link>
                </div>
              </form>
            </Card>

            <Card>
              <p className="mb-3 text-sm text-mutedtext">
                {log.total} entr{log.total === 1 ? "y" : "ies"} · page {log.page} of {log.pages}
              </p>
              {log.rows.length === 0 ? (
                <p className="text-sm text-sapphire">Nothing matches these filters.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {log.rows.map((r) => (
                    <li key={r.id} className="py-3 text-sm hover:bg-rowhover">
                      <div className="grid gap-x-4 gap-y-1 md:grid-cols-[11rem_9rem_14rem_1fr]">
                        <span className="text-mutedtext">{when(r.at)}</span>
                        <span className="font-bold text-sapphire">{r.actor ?? "System"}</span>
                        <span className="font-semibold text-sapphire">{r.action}</span>
                        <span className="text-mutedtext">
                          {r.entity} {r.entityId}
                        </span>
                      </div>
                      {(r.before !== null || r.after !== null) && (
                        <details className="mt-1 text-xs text-mutedtext">
                          <summary className="min-h-[44px] cursor-pointer py-3 font-semibold text-royal">Details</summary>
                          {r.before !== null && <p className="break-words">Before: {short(r.before)}</p>}
                          {r.after !== null && <p className="break-words">After: {short(r.after)}</p>}
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex gap-3">
                {log.page > 1 && (
                  <Link href={link(log.page - 1)} className={btnSecondary}>
                    Newer
                  </Link>
                )}
                {log.page < log.pages && (
                  <Link href={link(log.page + 1)} className={btnSecondary}>
                    Older
                  </Link>
                )}
              </div>
            </Card>
          </div>
        );
      }}
    />
  );
}
