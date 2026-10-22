import { getDb } from "@/db/client";
import { NewRunForm } from "@/components/NewRunForm";
import { Protected } from "@/components/Shell";
import { STOP_MESSAGE } from "@/lib/kill/logic";
import { automationStopped } from "@/lib/kill/service";

export const metadata = { title: "New run | Freshroots Demand Planning" };

export default function NewRunPage() {
  return (
    <Protected
      permission="upload_data"
      render={async () => {
        // "Start run" is disabled while a kill is active, and says why (docs/07, screen 2).
        const { stopped, which } = await automationStopped(getDb());
        const blockedReason = stopped ? `${which.map((w) => STOP_MESSAGE(w)).join(" ")} A new run cannot start until it is re-armed.` : null;
        return <NewRunForm blockedReason={blockedReason} />;
      }}
    />
  );
}
