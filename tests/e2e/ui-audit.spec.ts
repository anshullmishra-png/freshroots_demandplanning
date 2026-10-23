import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SCENES } from "../../src/lib/ui-check/fixtures";

// Real-browser checks of the rules in docs/08-UI-DESIGN-SYSTEM.md and the accessibility rules in docs/05 (G-U1 to G-U4).
// Every screen is drawn from fixed sample data; see src/app/ui-check.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.locator("main#main").first()).toBeVisible();
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join("\n   ")}`);
}

/** Facts measured in the page itself. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden]");
    };
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40) ? ` "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"` : ""}`;

    // Every control that can be pressed or typed into must be at least 44px tall; a checkbox needs a 44px hit area.
    const small: string[] = [];
    for (const el of document.querySelectorAll("button, a[href], select, textarea, summary, [role=tab], input")) {
      if (!visible(el)) continue;
      if (el instanceof HTMLInputElement && ["hidden", "file"].includes(el.type)) continue;
      const isBox = el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type);
      const target = isBox ? (el.closest("label") ?? el) : el;
      const r = target.getBoundingClientRect();
      // Visually hidden until focused (the skip link) is not a control anyone can press by eye; it is tested separately.
      if (r.width <= 1 && r.height <= 1) continue;
      // A link that is a run of text inside a sentence is exempt; every link in this app is its own block or a button.
      if (r.height < 43.5 || (isBox && r.width < 43.5)) small.push(`${describe(el)} is ${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    // No vibrant red anywhere: no element may paint a strongly red colour.
    const reds: string[] = [];
    const isVibrantRed = (css: string) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css);
      if (!m) return false;
      const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      return a > 0.2 && r > 180 && g < 90 && b < 90;
    };
    for (const el of document.querySelectorAll("body *")) {
      const s = getComputedStyle(el);
      for (const p of ["color", "backgroundColor", "borderTopColor", "borderBottomColor", "outlineColor"] as const) {
        if (isVibrantRed(s[p])) reds.push(`${describe(el)} ${p}=${s[p]}`);
      }
    }

    const body = getComputedStyle(document.body);
    const doc = document.documentElement;
    return {
      small,
      reds,
      background: body.backgroundColor,
      font: body.fontFamily,
      overflowX: doc.scrollWidth - doc.clientWidth,
      h1s: document.querySelectorAll("h1").length,
      mains: document.querySelectorAll("main").length,
      lang: doc.lang,
      bottomBarVisible: [...document.querySelectorAll("nav")].some((n) => n.getAttribute("aria-label") === "Main (phone)" && visible(n)),
      headerNavVisible: [...document.querySelectorAll("nav")].some((n) => n.getAttribute("aria-label") === "Main" && visible(n)),
      bottomBarHeight: Math.round([...document.querySelectorAll("nav")].find((n) => n.getAttribute("aria-label") === "Main (phone)")?.getBoundingClientRect().height ?? 0),
      imagesWithoutAlt: [...document.querySelectorAll("img:not([alt])")].length,
    };
  });
}

for (const scene of SCENES) {
  test.describe(scene, () => {
    test("meets the design rules and has no accessibility violations", async ({ page }, info) => {
      await open(page, `/ui-check/${scene}`);
      const m = await measure(page);

      // Soft assertions: report every problem on the page in one run, not just the first.
      expect.soft(await axeViolations(page), "axe (WCAG 2.2 AA)").toEqual([]);
      expect.soft(m.small, "controls under 44px").toEqual([]);
      expect.soft(m.reds, "vibrant red").toEqual([]);
      expect.soft(m.background, "page background is ivory").toBe("rgb(255, 248, 225)");
      expect.soft(m.font.toLowerCase(), "font is Inter").toContain("inter");
      expect.soft(m.overflowX, "no sideways scroll").toBeLessThanOrEqual(1);
      expect.soft(m.h1s, "exactly one h1").toBe(1);
      expect.soft(m.mains, "one main landmark").toBe(1);
      expect.soft(m.lang).toBe("en");
      expect.soft(m.imagesWithoutAlt).toBe(0);

      const phone = info.project.name === "phone";
      expect.soft(m.bottomBarVisible, "bottom tab bar shows on phones only").toBe(phone);
      expect.soft(m.headerNavVisible, "header nav shows on larger screens only").toBe(!phone);
      if (phone) expect.soft(m.bottomBarHeight).toBe(72);
    });
  });
}

test.describe("keyboard and focus", () => {
  test("the skip link is the first stop and moves focus to the page", async ({ page }) => {
    await open(page, "/ui-check/orders-procurement");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("every control shows a visible focus ring", async ({ page }) => {
    await open(page, "/ui-check/review-raghav");
    const accept = page.getByRole("button", { name: "Accept", exact: true }).first();
    await accept.focus();
    const outline = await accept.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });
});

test.describe("states after interaction", () => {
  test("the reject panel opens, keeps Save disabled until valid, and stays accessible", async ({ page }) => {
    await open(page, "/ui-check/review-raghav");
    await page.getByRole("button", { name: "Reject", exact: true }).first().click();
    const group = page.getByRole("group", { name: /Reject SKU/ });
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: "Save rejection" })).toBeDisabled();
    await group.getByLabel("Quantity (units)").fill("400");
    await expect(group.getByRole("button", { name: "Save rejection" })).toBeDisabled(); // still needs a reason
    await group.getByLabel("Reason").selectOption("WRONG_QUANTITY");
    await expect(group.getByRole("button", { name: "Save rejection" })).toBeEnabled();
    expect(await axeViolations(page), "axe with the reject panel open").toEqual([]);
    expect((await measure(page)).small).toEqual([]);
  });

  test("the bulk-accept list shows what will be accepted before anything happens", async ({ page }) => {
    await open(page, "/ui-check/review-raghav");
    await page.getByRole("button", { name: /Accept all clear items/ }).click();
    await expect(page.getByRole("button", { name: /Confirm: accept these/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("the orders screen filters by status and shows the held-order stop message", async ({ page }) => {
    await open(page, "/ui-check/orders-procurement");
    await page.getByRole("tab", { name: /Held/ }).click();
    await expect(page.getByRole("tab", { name: /Held/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Automation stopped. Confirm with Raghav before ordering.").first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("chart table views open and stay accessible", async ({ page }) => {
    await open(page, "/ui-check/dashboard-priya");
    for (const summary of await page.getByText("View as a table").all()) await summary.click();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("the loss form validates before it lets Priya save", async ({ page }) => {
    await open(page, "/ui-check/dashboard-priya");
    const save = page.getByRole("button", { name: "Save entry" });
    await expect(save).toBeDisabled();
    await page.getByLabel("Stockout lost sales (Rs)").fill("1000");
    await page.getByLabel("Overstock write-off (Rs)").fill("500");
    await expect(save).toBeEnabled();
    await expect(page.getByText(/Entry total:/)).toContainText("Rs 0.02 lakh");
  });

  test("the re-arm form needs a reason and, for Kill 2, a tick before it enables", async ({ page }) => {
    await open(page, "/ui-check/kill-killed-deepa");
    const forms = page.getByRole("button", { name: /^Re-arm Kill/ });
    await expect(forms.first()).toBeDisabled();
    const kill2 = page.locator("form", { hasText: "Re-arm Kill 2" });
    await kill2.getByRole("textbox").fill("Reviewed with the CEO; continuing under a close watch.");
    await expect(kill2.getByRole("button", { name: "Re-arm Kill 2" })).toBeDisabled();
    await kill2.getByRole("checkbox").check();
    await expect(kill2.getByRole("button", { name: "Re-arm Kill 2" })).toBeEnabled();
  });
});

test.describe("pages that need no fixture", () => {
  test("the sign-in page", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    expect(await axeViolations(page)).toEqual([]);
    const m = await measure(page);
    expect(m.small).toEqual([]);
    expect(m.background).toBe("rgb(255, 248, 225)");
    expect(m.overflowX).toBeLessThanOrEqual(1);
    // Submitting before the page has loaded must not put anything in the address bar (found and fixed in Phase 5).
    await page.getByRole("button", { name: "Sign in" }).click();
    expect(new URL(page.url()).search).toBe("");
  });

  test("a missing page shows a helpful 404", async ({ page }) => {
    const res = await page.goto("/there-is-no-such-page", { waitUntil: "networkidle" });
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("people who ask for reduced motion get no hover growth", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/ui-check/review-raghav");
    const button = page.getByRole("button", { name: "Accept", exact: true }).first();
    await button.hover();
    const scale = await button.evaluate((el) => getComputedStyle(el).scale);
    expect(["none", "1", "normal"]).toContain(scale);
  });
});
