import { Sprout } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { BottomTabBar } from "@/components/BottomTabBar";
import { NavLinks } from "@/components/NavLinks";
import { SignOutButton } from "@/components/SignOutButton";
import { StatusBanner } from "@/components/StatusBanner";
import { PageContainer, SkeletonBlock } from "@/components/ui";
import { navFor, tabsFor, type Permission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/server";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The page frame: skip link, sticky header, a slot for the status banner, the page, and on phones a fixed bottom tab
 * bar (docs/08, layout). Pure, so the browser checks can render it with fixture data and no database.
 */
export function ShellFrame({ user, banner, children }: { user: Pick<SessionUser, "name" | "role">; banner?: ReactNode; children: ReactNode }) {
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="min-h-screen bg-ivory">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-btn focus:bg-sapphire focus:px-4 focus:py-3 focus:font-bold focus:text-white"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-border bg-surface px-4 md:px-8">
        <Link href="/" className="flex min-h-[44px] items-center gap-2 text-lg font-bold text-sapphire">
          <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-sapphire text-white">
            <Sprout size={20} aria-hidden="true" />
          </span>
          Freshroots
        </Link>
        <div className="hidden md:block">
          <NavLinks items={navFor(user.role)} />
        </div>
        <div className="flex items-center gap-3">
          {/* The visible initials are part of the accessible name (WCAG label-in-name); the rest is for screen readers. */}
          <Link href="/account" className="flex h-11 w-11 items-center justify-center rounded-full bg-sapphire text-sm font-bold text-white">
            <span>{initials}</span>
            <span className="sr-only">, your account, {user.name}</span>
          </Link>
          <span className="hidden text-xs font-bold uppercase tracking-wide text-sapphire lg:inline">{user.name}</span>
          <div className="hidden md:block">
            <SignOutButton />
          </div>
        </div>
      </header>
      {banner}
      <PageContainer>{children}</PageContainer>
      <BottomTabBar items={tabsFor(user.role)} />
    </div>
  );
}

export function Shell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <ShellFrame
      user={user}
      banner={
        <Suspense fallback={null}>
          <StatusBanner role={user.role} />
        </Suspense>
      }
    >
      {children}
    </ShellFrame>
  );
}

/** While a page's data loads: the header's height is kept, and the content area shows placeholder shapes. */
export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-ivory" role="status" aria-busy="true">
      <span className="sr-only">Loading the page</span>
      <div className="h-16 border-b border-border bg-surface" />
      <PageContainer>
        <SkeletonBlock className="mb-8 h-24" />
        <div className="grid gap-8 md:grid-cols-2">
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
        </div>
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
