import { forbidden } from "@/lib/errors";

export type Role = "raghav" | "procurement" | "priya" | "deepa" | "ceo" | "admin";
export const ROLES: Role[] = ["raghav", "procurement", "priya", "deepa", "ceo", "admin"];

export type Permission =
  | "upload_data"
  | "start_run"
  | "view_review"
  | "review"
  | "view_orders"
  | "mark_placed"
  | "export_orders"
  | "view_dashboard"
  | "enter_loss"
  | "export_metrics"
  | "ack_alert"
  | "rearm_kill"
  | "view_audit"
  | "manage_users";

// docs/07-WORKFLOW-AND-SCREENS.md, "Roles and access". Deepa sees everything read-only.
const GRANTS: Record<Role, Permission[]> = {
  raghav: ["upload_data", "start_run", "view_review", "review", "view_dashboard"],
  procurement: ["view_orders", "mark_placed", "export_orders", "view_dashboard"],
  priya: ["view_dashboard", "enter_loss", "export_metrics"],
  deepa: ["view_dashboard", "view_review", "view_orders", "view_audit", "ack_alert", "rearm_kill"],
  ceo: ["view_dashboard", "rearm_kill"],
  // Admin manages users. Reviewing is break-glass: allowed, and always written to the audit log (G-H7).
  admin: ["manage_users", "view_audit", "view_dashboard", "view_review", "review"],
};

/** Permissions an admin may use only as a logged break-glass action. */
const BREAK_GLASS: Permission[] = ["review"];

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export function isBreakGlass(role: Role, permission: Permission): boolean {
  return role === "admin" && BREAK_GLASS.includes(permission);
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw forbidden(`The ${role} role cannot do this (${permission}).`);
}

/** Where each role lands after signing in (docs/07, screen 1). */
export function homeFor(role: Role): string {
  if (role === "raghav") return "/review";
  if (role === "procurement") return "/orders";
  return "/dashboard";
}

export interface NavItem {
  href: string;
  label: string;
}

/** Header navigation by role (docs/08-UI-DESIGN-SYSTEM.md). */
export function navFor(role: Role): NavItem[] {
  switch (role) {
    case "raghav":
      return [
        { href: "/run/new", label: "Run" },
        { href: "/review", label: "Review" },
        { href: "/dashboard", label: "Dashboard" },
      ];
    case "procurement":
      return [
        { href: "/orders", label: "Orders" },
        { href: "/dashboard", label: "Dashboard" },
      ];
    case "priya":
      return [{ href: "/dashboard", label: "Dashboard" }];
    case "deepa":
      return [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/kill", label: "Kill and alerts" },
        { href: "/audit", label: "Audit" },
      ];
    case "ceo":
      // docs/08 lists Audit for the CEO but docs/07 gives the audit screen to Deepa and admin only; docs/07 wins (Q31).
      return [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/kill", label: "Kill and alerts" },
      ];
    case "admin":
      return [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/review", label: "Review" },
        { href: "/audit", label: "Audit" },
        { href: "/settings", label: "Settings" },
      ];
  }
}
