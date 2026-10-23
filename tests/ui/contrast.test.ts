import { describe, expect, it } from "vitest";
import { GRAY_600, WHITE, contrast, over, tokens, type RGB } from "../helpers/contrast";

const t = tokens();
const AA_TEXT = 4.5; // normal-size text
const AA_UI = 3; // focus rings, icons, borders that carry meaning

// Every text-on-background pair the app draws. "bg-x/20" means token x at 20% over the surface beneath it.
const surface = t.surface;
const ivory = t.ivory;
const pairs: Array<[name: string, text: RGB, bg: RGB]> = [
  ["body text on the ivory page", t.sapphire, ivory],
  ["text on cards and header", t.sapphire, surface],
  ["text in highlight boxes", t.sapphire, t.highlight],
  ["text on a hovered row", t.sapphire, t["row-hover"]],
  ["primary button: sapphire on gold", t.sapphire, t.gold],
  ["active pill: sapphire on gold", t.sapphire, t.gold],
  ["success pill: sapphire on emerald", t.sapphire, t.emerald],
  ["secondary text on ivory", t["muted-text"], ivory],
  ["secondary text on cards", t["muted-text"], surface],
  ["secondary text in highlight boxes", t["muted-text"], t.highlight],
  ["danger text on its tint (banners, pills)", t["danger-muted"], t["danger-muted-bg"]],
  ["danger text on cards (inline errors)", t["danger-muted"], surface],
  ["danger text on a lightly tinted row", t["danger-muted"], over(t["danger-muted-bg"], 0.5, surface)],
  ["link text on cards", t["royal-text"], surface],
  ["link text on ivory", t["royal-text"], ivory],
  ["link text on highlight boxes", t["royal-text"], t.highlight],
  ["quoted pill on a card", t.sapphire, over(t.sapphire, 0.1, surface)],
  ["quoted pill on the page", t.sapphire, over(t.sapphire, 0.1, ivory)],
  ["expired pill on a card", GRAY_600, over(t.track, 0.3, surface)],
  ["expired pill on the page", GRAY_600, over(t.track, 0.3, ivory)],
  ["gold notice on the page", t.sapphire, over(t.gold, 0.2, ivory)],
  ["gold notice on a card", t.sapphire, over(t.gold, 0.15, surface)],
  ["gold-tinted row", t.sapphire, over(t.gold, 0.1, surface)],
  ["emerald notice", t.sapphire, over(t.emerald, 0.15, surface)],
  ["needs-judgment pill", t.sapphire, surface],
  ["logo and avatar: white on sapphire", WHITE, t.sapphire],
  ["selected tab: white on sapphire", WHITE, t.sapphire],
  ["error banner on the page", t["danger-muted"], t["danger-muted-bg"]],
];

describe("contrast of every text and background pair (WCAG AA, 4.5:1)", () => {
  it.each(pairs)("%s", (_name, text, bg) => {
    expect(contrast(text, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("white text on emerald, as the design brief wrote it, fails: that is why the success pill uses sapphire text", () => {
    expect(contrast(WHITE, t.emerald)).toBeLessThan(AA_TEXT);
    expect(contrast(t.sapphire, t.emerald)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("royal blue as small text on white fails, so link text uses the derived royal-text token", () => {
    expect(contrast(t.royal, surface)).toBeLessThan(AA_TEXT);
    expect(contrast(t["royal-text"], surface)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("contrast of things that are not text (3:1)", () => {
  it.each([
    ["focus ring (royal) on cards", t.royal, surface],
    ["focus ring (royal) on the page", t.royal, ivory],
    // The 2px gold border on a needs-judgment item (1.9:1 on the page) is decorative reinforcement: the item also carries a
    // "Needs judgment" pill with an icon and the reasons in words, so colour is never the only signal (WCAG 1.4.1).
    ["sapphire cover-bar marker on its track", t.sapphire, over(t.track, 0.4, surface)],
    ["dashed limit line (danger-muted) on cards", t["danger-muted"], surface],
    ["card border on the page keeps cards distinguishable at a glance", t.border, ivory],
  ] as Array<[string, RGB, RGB]>)("%s", (name, fg, bg) => {
    // A card border is decorative (the card also has a shadow and content), so it only needs to be visible, not 3:1.
    const min = name.startsWith("card border") ? 1.05 : AA_UI;
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe("the design tokens are the ones docs/08 specifies", () => {
  it.each([
    ["sapphire", "#002d72"],
    ["gold", "#f9a825"],
    ["emerald", "#10b981"],
    ["royal", "#1e88e5"],
    ["ivory", "#fff8e1"],
    ["border", "#e0ddd6"],
    ["surface", "#ffffff"],
    ["highlight", "#f4f1ec"],
    ["row-hover", "#f9f8f6"],
    ["track", "#d1d5db"],
    ["muted-text", "#666666"],
    ["danger-muted", "#94504a"], // docs/08 derived #a65d57; darkened because that failed 4.5:1 on its own tint
    ["danger-muted-bg", "#f3e4e2"],
  ])("--%s is %s", (name, hex) => {
    const [r, g, b] = t[name];
    expect(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`).toBe(hex);
  });

  it("no vibrant red anywhere in the tokens: the only reddish colour is the muted terracotta", () => {
    for (const [name, [r, g, b]] of Object.entries(t)) {
      const vibrantRed = r > 180 && g < 90 && b < 90;
      expect(vibrantRed, name).toBe(false);
    }
  });
});
