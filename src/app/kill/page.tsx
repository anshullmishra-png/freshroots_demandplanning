import { ComingSoon } from "@/components/ComingSoon";
import { Protected } from "@/components/Shell";

export default function KillPage() {
  return (
    <Protected
      permission="rearm_kill"
      render={() => (
        <ComingSoon label="Kill switches" title="Kill and alerts" text="The state of both kill switches, alert acknowledgement and re-arming will appear here. This screen is built in a later phase." />
      )}
    />
  );
}
