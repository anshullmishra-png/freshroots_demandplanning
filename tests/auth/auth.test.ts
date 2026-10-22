import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "@/lib/auth/password";
import { ROLES, can, homeFor, isBreakGlass, navFor, type Permission, type Role } from "@/lib/auth/permissions";
import { clearedSessionCookie, parseCookies, sessionCookie, verifySessionToken, createSessionToken } from "@/lib/auth/session";

describe("passwords", () => {
  it("stores a salted scrypt hash, never the password", async () => {
    const a = await hashPassword("a-long-enough-password");
    const b = await hashPassword("a-long-enough-password");
    expect(a).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
    expect(a).not.toContain("a-long-enough-password");
    expect(a).not.toBe(b); // a fresh salt each time
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("a-long-enough-password");
    expect(await verifyPassword("a-long-enough-password", hash)).toBe(true);
    expect(await verifyPassword("a-long-enough-passwore", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("an unknown or missing hash never verifies", async () => {
    expect(await verifyPassword("anything-at-all-1", null)).toBe(false);
    expect(await verifyPassword("anything-at-all-1", "plaintext")).toBe(false);
  });

  it("refuses short passwords", async () => {
    await expect(hashPassword("x".repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(/at least/);
  });
});

describe("sessions", () => {
  it("round-trips a user id and nothing else", async () => {
    expect(await verifySessionToken(await createSessionToken(42))).toBe(42);
  });
  it("treats missing and bad tokens as signed out", async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("a.b.c")).toBeNull();
  });
  it("needs a long AUTH_SECRET", async () => {
    const saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "short";
    try {
      await expect(createSessionToken(1)).rejects.toThrow(/AUTH_SECRET/);
    } finally {
      process.env.AUTH_SECRET = saved;
    }
  });
  it("parses cookies and builds safe Set-Cookie strings", () => {
    expect(parseCookies("a=1; fr_session=abc.def; b=x%20y")).toEqual({ a: "1", fr_session: "abc.def", b: "x y" });
    expect(parseCookies(null)).toEqual({});
    const set = sessionCookie("tok", { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv);
    for (const part of ["fr_session=tok", "HttpOnly", "SameSite=Lax", "Path=/", "Secure", "Max-Age=28800"]) expect(set).toContain(part);
    expect(clearedSessionCookie()).toContain("Max-Age=0");
  });
});

// docs/07-WORKFLOW-AND-SCREENS.md, "Roles and access", written out in full.
const EXPECTED: Record<Role, Permission[]> = {
  raghav: ["upload_data", "start_run", "view_review", "review", "view_dashboard"],
  procurement: ["view_orders", "mark_placed", "export_orders", "view_dashboard"],
  priya: ["view_dashboard", "enter_loss", "export_metrics"],
  deepa: ["view_dashboard", "view_review", "view_orders", "view_audit", "ack_alert", "rearm_kill"],
  ceo: ["view_dashboard", "rearm_kill"],
  admin: ["manage_users", "view_audit", "view_dashboard", "view_review", "review"],
};
const ALL: Permission[] = [
  "upload_data", "start_run", "view_review", "review", "view_orders", "mark_placed", "export_orders", "view_dashboard",
  "enter_loss", "export_metrics", "ack_alert", "rearm_kill", "view_audit", "manage_users",
];

describe("roles and permissions (docs/07)", () => {
  it.each(ROLES)("%s has exactly the documented permissions", (role) => {
    expect(ALL.filter((p) => can(role, p)).sort()).toEqual([...EXPECTED[role]].sort());
  });

  it("only Raghav can start runs and upload; nobody but Raghav (and admin break-glass) can review", () => {
    expect(ROLES.filter((r) => can(r, "start_run"))).toEqual(["raghav"]);
    expect(ROLES.filter((r) => can(r, "upload_data"))).toEqual(["raghav"]);
    expect(ROLES.filter((r) => can(r, "review")).sort()).toEqual(["admin", "raghav"]);
  });

  it("only Deepa and the CEO can re-arm a kill switch", () => {
    expect(ROLES.filter((r) => can(r, "rearm_kill")).sort()).toEqual(["ceo", "deepa"]);
  });

  it("only Priya can enter losses; only procurement can mark orders placed", () => {
    expect(ROLES.filter((r) => can(r, "enter_loss"))).toEqual(["priya"]);
    expect(ROLES.filter((r) => can(r, "mark_placed"))).toEqual(["procurement"]);
  });

  it("an admin's review is break-glass; Raghav's is not", () => {
    expect(isBreakGlass("admin", "review")).toBe(true);
    expect(isBreakGlass("raghav", "review")).toBe(false);
    expect(isBreakGlass("admin", "manage_users")).toBe(false);
  });

  it("sends each role to its landing page", () => {
    expect(ROLES.map((r) => homeFor(r))).toEqual(["/review", "/orders", "/dashboard", "/dashboard", "/dashboard", "/dashboard"]);
  });

  it("builds the header navigation from docs/08", () => {
    expect(navFor("raghav").map((n) => n.label)).toEqual(["Run", "Review", "Dashboard"]);
    expect(navFor("procurement").map((n) => n.label)).toEqual(["Orders", "Dashboard"]);
    expect(navFor("priya").map((n) => n.label)).toEqual(["Dashboard"]);
    expect(navFor("deepa").map((n) => n.label)).toEqual(["Dashboard", "Kill and alerts", "Audit"]);
    expect(navFor("ceo").map((n) => n.label)).toEqual(["Dashboard", "Kill and alerts"]); // no Audit: docs/07 gives it to Deepa and admin
    expect(navFor("admin").map((n) => n.label)).toEqual(["Dashboard", "Review", "Audit", "Settings"]);
  });
});
