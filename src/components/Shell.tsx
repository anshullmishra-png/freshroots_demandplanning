import { Sprout } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { NavLinks } from "@/components/NavLinks";
import { SignOutButton } from "@/components/SignOutButton";
import { PageContainer } from "@/components/ui";
import { navFor, type Permission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/server";
import type { SessionUser } from "@/lib/auth/session";

export function Shell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="min-h-screen bg-ivory">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-border bg-surface px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-sapphire">
          <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-sapphire text-white">
            <Sprout size={20} aria-hidden="true" />
          </span>
          Freshroots
        </Link>
        <NavLinks items={navFor(user.role)} />
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full bg-sapphire text-sm font-bold text-white"
            aria-hidden="true"
          >
            {initials}
          </span>
          <span className="hidden text-xs font-bold uppercase tracking-wide text-sapphire lg:inline">{user.name}</span>
          <SignOutButton />
        </div>
      </header>
      <PageContainer>{children}</PageContainer>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-ivory">
      <div className="h-16 border-b border-border bg-surface" />
      <PageContainer>
        <p className="text-mutedtext">Loading...</p>
      </PageContainer>
    </div>
  );
}

/**
 * Wraps a page that needs a signed-in user. The session is read inside a Suspense boundary, as Cache Components
 * requires for anything that depends on the request. Wrong role or no session redirects on the server (G-S3).
 */
export function Protected({
  permission,
  render,
}: {
  permission?: Permission;
  render: (user: SessionUser) => Promise<ReactNode> | ReactNode;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProtectedInner permission={permission} render={render} />
    </Suspense>
  );
}

async function ProtectedInner({
  permission,
  render,
}: {
  permission?: Permission;
  render: (user: SessionUser) => Promise<ReactNode> | ReactNode;
}) {
  const user = await requireUser(permission);
  return <Shell user={user}>{await render(user)}</Shell>;
}
