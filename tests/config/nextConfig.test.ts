import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../../next.config";

const root = path.resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("security headers", () => {
  it("are applied to every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers).toEqual(SECURITY_HEADERS);
  });

  it("include the five that matter, with safe values", () => {
    const h = Object.fromEntries(SECURITY_HEADERS.map((x) => [x.key, x.value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  it("never allow framing from anywhere, and never use a wildcard source", () => {
    const csp = SECURITY_HEADERS.find((x) => x.key === "Content-Security-Policy")!.value;
    expect(csp).not.toMatch(/\*/);
    expect(csp).not.toMatch(/unsafe-eval/);
  });

  it("do not announce the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("the AI prompts are shipped with the routes that read them", () => {
  // Routes whose source mentions getAiRuntime read the prompt files from disk at run time.
  const routes = walk(path.join(root, "src/app/api"))
    .filter((f) => f.endsWith("route.ts") && readFileSync(f, "utf8").includes("getAiRuntime"))
    .map((f) => "/" + path.relative(path.join(root, "src/app"), path.dirname(f)).split(path.sep).join("/"));

  it("finds the two routes that call the AI", () => {
    expect(routes.sort()).toEqual(["/api/runs", "/api/runs/[id]/continue"]);
  });

  it.each(routes)("%s has the prompts in its trace", (route) => {
    const key = route.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    const globs = (nextConfig.outputFileTracingIncludes ?? {})[key];
    expect(globs, `no outputFileTracingIncludes entry for ${key}`).toBeDefined();
    expect(globs).toContain("./prompts/**/*");
  });

  it("the prompt files exist where the loader looks", () => {
    expect(existsSync(path.join(root, "prompts/flag-decision.system.md"))).toBe(true);
    expect(existsSync(path.join(root, "prompts/flag-decision.user.md"))).toBe(true);
  });
});

describe("runtime", () => {
  it("declares the Node version it needs", () => {
    expect(pkg.engines.node).toBe(">=22");
  });

  it("the cron route is the only scheduled job in vercel.json", () => {
    const v = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
    expect(v.crons).toEqual([{ path: "/api/cron/kill-check", schedule: "30 0 * * *" }]);
  });
});
