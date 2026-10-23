import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES, ROLE_LABELS, navFor, tabsFor } from "@/lib/auth/permissions";

// Static checks of docs/08-UI-DESIGN-SYSTEM.md on the source. The browser audit (npm run test:ui) checks the same rules
// on the rendered pages; these run in every `npm test` and fail fast.

const root = path.resolve(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
const tsx = files(root).filter((f) => f.endsWith(".tsx"));
const rel = (f: string) => path.relative(root, f);
const source = (f: string) => readFileSync(f, "utf8");

describe("colours stay inside the token set", () => {
  // Tailwind's default palette names. The design system's own tokens (emerald, and gray-600 for the expired pill) are the only exceptions.
  const PALETTE = /\b(?:bg|text|border|fill|stroke|ring|accent|from|via|to|divide|outline)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)(-\d{2,3})?\b/g;

  it("no default-palette colour is used except the design system's own emerald and the expired pill's gray-600", () => {
    const offenders: string[] = [];
    for (const f of tsx) {
      for (const m of source(f).matchAll(PALETTE)) {
        const [whole, name, shade] = m;
        const allowed = (name === "emerald" && !shade) || whole === "text-gray-600";
        if (!allowed) offenders.push(`${rel(f)}: ${whole}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("there is no vibrant red anywhere in the classes", () => {
    for (const f of tsx) expect(source(f), rel(f)).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-red-?\d*/);
  });

  it("no raw hex colour sits in a class, and the only hex colours in components are inside SVG-free token use", () => {
    const offenders = tsx.filter((f) => /\[#[0-9a-fA-F]{3,8}\]/.test(source(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("animation: transform and opacity only, 200ms (docs/08)", () => {
  it("no component transitions anything but transform and opacity", () => {
    const offenders: string[] = [];
    for (const f of tsx) {
      for (const m of source(f).matchAll(/\btransition(?:-(all|colors|shadow|none))?\b(?![-[])/g)) offenders.push(`${rel(f)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the shared button transitions transform and opacity in 200ms", () => {
    expect(source(path.join(root, "components/ui.tsx"))).toContain("transition-[transform,opacity] duration-200 ease-in-out");
  });

  it("reduced motion switches animation and hover growth off", () => {
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*scale: none/);
  });
});

describe("controls are at least 44px (docs/08, G-U2)", () => {
  it("every button carries a shared button class or an explicit 44px minimum", () => {
    const offenders: string[] = [];
    for (const f of tsx) {
      const text = source(f);
      // A button's opening tag can span lines and hold arrow functions, so look at everything up to its closing tag.
      for (const m of text.matchAll(/<button\b/g)) {
        const body = text.slice(m.index, text.indexOf("</button>", m.index));
        if (!/btnPrimary|btnSecondary|min-h-\[44px\]|\bh-11\b/.test(body.slice(0, 600))) offenders.push(`${rel(f)}: ${body.slice(0, 90).replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("form inputs use the shared 44px input style", () => {
    const css = source(path.join(root, "components/ui.tsx"));
    expect(css).toMatch(/inputClass =\s*"min-h-\[44px\]/);
  });
});

describe("accessibility basics in the shell", () => {
  const shell = source(path.join(root, "components/Shell.tsx"));
  it("has a skip link to the main landmark, and the main landmark exists", () => {
    expect(shell).toContain('href="#main"');
    expect(source(path.join(root, "components/ui.tsx"))).toContain('id="main"');
  });
  it("the page language is set", () => {
    expect(source(path.join(root, "app/layout.tsx"))).toContain('lang="en"');
  });
  it("the account link's accessible name contains its visible initials (label in name)", () => {
    expect(shell).toContain("<span>{initials}</span>");
    expect(shell).not.toMatch(/aria-label=\{`Your account/);
  });
});

describe("the phone's bottom tab bar (docs/08)", () => {
  it.each(ROLES)("%s gets at most four tabs, ending with Account", (role) => {
    const tabs = tabsFor(role);
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(tabs.length).toBeLessThanOrEqual(4);
    expect(tabs.at(-1)).toEqual({ href: "/account", label: "Account" });
  });

  it("each tab is a page that role can open from the header too", () => {
    for (const role of ROLES) {
      const header = new Set(navFor(role).map((n) => n.href));
      for (const tab of tabsFor(role).slice(0, -1)) expect(header.has(tab.href), `${role}: ${tab.href}`).toBe(true);
    }
  });

  it("Raghav's tabs are Run, Review, Dashboard, Account; procurement's are Orders, Dashboard, Account", () => {
    expect(tabsFor("raghav").map((t) => t.label)).toEqual(["Run", "Review", "Dashboard", "Account"]);
    expect(tabsFor("procurement").map((t) => t.label)).toEqual(["Orders", "Dashboard", "Account"]);
  });

  it("every role has a plain-language job title for the Account page", () => {
    for (const role of ROLES) expect(ROLE_LABELS[role].length).toBeGreaterThan(2);
  });
});

describe("the fixture pages are off unless asked for", () => {
  it("/ui-check refuses to render unless the build was made with UI_CHECK=1", () => {
    const page = source(path.join(root, "app/ui-check/[scene]/page.tsx"));
    expect(page).toContain('process.env.UI_CHECK === "1"');
    expect(page).toMatch(/if \(!ENABLED[^\n]*notFound\(\)/);
  });

  it("the fixtures hold no real names, emails or secrets", () => {
    const fixtures = source(path.join(root, "lib/ui-check/fixtures.ts"));
    expect(fixtures).not.toMatch(/@[a-z0-9-]+\.(com|in|co|org)\b/i);
    // Credential-shaped values, not the words: the file's own comment says "no secrets".
    expect(fixtures).not.toMatch(/postgres(ql)?:\/\/|AIza|Bearer\s|password\s*[:=]|api[_-]?key\s*[:=]/i);
  });
});
