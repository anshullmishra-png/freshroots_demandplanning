import { ComingSoon } from "@/components/ComingSoon";
import { Protected } from "@/components/Shell";

export default function AuditPage() {
  return (
    <Protected
      permission="view_audit"
      render={() => (
        <ComingSoon label="Audit" title="Audit log" text="A filterable table of every recorded action will appear here. Entries are already being written. This screen is built in a later phase." />
      )}
    />
  );
}
