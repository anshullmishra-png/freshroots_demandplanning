import { readFileSync } from "node:fs";
import path from "node:path";

// WCAG 2.x contrast, computed from the real design tokens in src/app/globals.css.

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour with transparency painted over an opaque one, as the browser does. */
export function over(top: RGB, alpha: number, below: RGB): RGB {
  return top.map((c, i) => Math.round(c * alpha + below[i] * (1 - alpha))) as RGB;
}

/** The tokens, read from globals.css so the test can never disagree with the app. */
export function tokens(): Record<string, RGB> {
  const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
  const root = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? "";
  const out: Record<string, RGB> = {};
  for (const m of root.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = hexToRgb(m[2]);
  return out;
}

/** Tailwind's gray-600, used by the "expired" pill text as the design system specifies. */
export const GRAY_600 = hexToRgb("#4b5563");
export const WHITE = hexToRgb("#ffffff");
