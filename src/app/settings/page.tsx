import { ComingSoon } from "@/components/ComingSoon";
import { Protected } from "@/components/Shell";

export default function SettingsPage() {
  return (
    <Protected
      permission="manage_users"
      render={() => (
        <ComingSoon label="Admin" title="Settings" text="User management and the active rules version will appear here. This screen is built in a later phase." />
      )}
    />
  );
}
