import Link from "next/link";
import { Protected } from "@/components/Shell";
import { Card, btnPrimary } from "@/components/ui";
import { homeFor } from "@/lib/auth/permissions";

export default function ForbiddenPage() {
  return (
    <Protected
      render={(user) => (
        <Card>
          <h1 className="text-2xl font-semibold text-sapphire">Your role cannot open this page</h1>
          <p className="mt-2 text-mutedtext">You are signed in as {user.name}. Ask an administrator if you need access.</p>
          <Link href={homeFor(user.role)} className={`${btnPrimary} mt-4`}>
            Go to my home page
          </Link>
        </Card>
      )}
    />
  );
}
