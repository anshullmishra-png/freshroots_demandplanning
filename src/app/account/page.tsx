import { AccountView } from "@/components/AccountView";
import { Protected } from "@/components/Shell";

export const metadata = { title: "Account | Freshroots Demand Planning" };

/** Who is signed in, and the way out. On phones this is the fourth tab. */
export default function AccountPage() {
  return <Protected render={(user) => <AccountView user={user} />} />;
}
