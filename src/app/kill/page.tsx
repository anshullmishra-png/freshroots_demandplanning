import { getDb } from "@/db/client";
import { KillView } from "@/components/KillView";
import { Protected } from "@/components/Shell";
import { can } from "@/lib/auth/permissions";
import { formatWeek, isoWeekOf, istDate, parseIsoDate } from "@/lib/dates/isoWeek";
import { getKillStatus, listKillEvents } from "@/lib/kill/service";

export const metadata = { title: "Kill and alerts | Freshroots Demand Planning" };

export default function KillPage() {
  return (
    <Protected
      permission="rearm_kill"
      render={async (user) => {
        const db = getDb();
        const [status, events] = await Promise.all([getKillStatus(db), listKillEvents(db)]);
        const week = formatWeek(isoWeekOf(parseIsoDate(istDate(new Date()))!));
        return <KillView status={status} events={events} canAcknowledge={can(user.role, "ack_alert")} week={week} />;
      }}
    />
  );
}
