import { getDb } from "@/db/client";
import { AuditView, type AuditParams } from "@/components/AuditView";
import { Protected } from "@/components/Shell";
import { getAuditLog, type AuditFilters } from "@/lib/workflow/auditLog";

export const metadata = { title: "Audit log | Freshroots Demand Planning" };

export default function AuditPage({ searchParams }: { searchParams: Promise<AuditParams> }) {
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
        return <AuditView log={await getAuditLog(getDb(), user, filters)} params={p} />;
      }}
    />
  );
}
