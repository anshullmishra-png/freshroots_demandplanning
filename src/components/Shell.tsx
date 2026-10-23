import { Sprout } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { BottomTabBar } from "@/components/BottomTabBar";
import { NavLinks } from "@/components/NavLinks";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { SignOutButton } from "@/components/SignOutButton";
import { SystemStatus } from "@/components/SystemStatus";
import { StatusBanner } from "@/components/StatusBanner";
import { PageContainer, SkeletonBlock } from "@/components/ui";
import { ROLE_LABELS, navFor, tabsFor, type Permission } from "@/lib/auth/permissions";
import { demoEnabled } from "@/lib/auth/demo";
import { requireUser } from "@/lib/auth/server";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The page frame: skip link, sticky header, a slot for the status banner, the page, and on phones a fixed bottom tab
 * bar (docs/08, layout). Pure, so the browser checks can render it with fixture data and no database.
 */
export function ShellFrame({
  user,
  banner,
  status,
  switcher,
  children,
}: {
  user: Pick<SessionUser, "name" | "role">;
  banner?: ReactNode;
  status?: ReactNode;
  /** "Switch role", on a preview with open access only. Hidden on phones, where the Account tab lists the roles. */
  switcher?: ReactNode;
  children: ReactNode;
}) {
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
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 bg-sapphire px-4 text-white shadow-[0_2px_12px_-4px_rgba(0,45,114,0.5)] md:px-8">
        <Link href="/" className="flex min-h-[44px] items-center gap-3 text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-gold text-sapphire">
            <Sprout size={20} aria-hidden="true" />
          </span>
          <span className="leading-tight">
            <span className="block text-lg font-bold">Freshroots</span>
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 sm:block">Demand planning</span>
          </span>
        </Link>
        <div className="hidden md:block">
          <NavLinks items={navFor(user.role)} />
        </div>
        <div className="flex items-center gap-3">
          {status}
          {switcher && <div className="hidden md:block">{switcher}</div>}
          {/* The visible initials are part of the accessible name (WCAG label-in-name); the rest is for screen readers. */}
          <Link href="/account" className="flex h-11 w-11 items-center justify-center rounded-full bg-gold text-sm font-bold text-sapphire">
            <span>{initials}</span>
            <span className="sr-only">, your account, {user.name}</span>
          </Link>
          <span className="hidden leading-tight lg:block">
            <span className="block text-sm font-semibold">{user.name}</span>
            {ROLE_LABELS[user.role].toLowerCase() !== user.name.toLowerCase() && <span className="block text-xs text-white/70">{ROLE_LABELS[user.role]}</span>}
          </span>
          <div className="hidden md:block">
            <SignOutButton onDark />
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
      status={
        <Suspense fallback={null}>
          <SystemStatus />
        </Suspense>
      }
      switcher={demoEnabled() ? <RoleSwitcher current={user.role} /> : null}
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
      <div className="h-16 bg-sapphire" />
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
