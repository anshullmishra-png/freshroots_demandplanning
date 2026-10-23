import { getDb } from "@/db/client";
import { getKillStatus, type KillStatus } from "@/lib/kill/service";

/**
 * A one-glance answer in the header on every page: is the automation running? The coloured dot is never alone: the
 * words say the same thing. Muted terracotta for stopped, never vibrant red (G-U1).
 */
export function SystemStatusView({ status }: { status: Pick<KillStatus, "stopped"> & { kill2: Pick<KillStatus["kill2"], "state"> } }) {
  const [dot, text] = status.stopped
    ? ["bg-dangermuted", "Automation stopped"]
    : status.kill2.state === "alert"
      ? ["bg-gold", "Loss alert"]
      : ["bg-emerald", "Automation running"];
  return (
    <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white sm:flex">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}

export async function SystemStatus() {
  return <SystemStatusView status={await getKillStatus(getDb())} />;
}
