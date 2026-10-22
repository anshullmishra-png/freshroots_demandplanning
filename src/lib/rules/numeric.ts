// Comparisons the rules need to be exact "as written" (guardrail G-R4): strictly greater, strictly less.
// Floating-point division can leave noise such as 1.2000000000000002 for a true 1.2, which would wrongly
// trip a strict ">". A tiny relative tolerance removes the noise without moving any real boundary:
// real data differs from a threshold by far more than one part in a billion.
const TOLERANCE = 1e-9;

function margin(b: number): number {
  return TOLERANCE * Math.max(1, Math.abs(b));
}

/** a > b, ignoring floating-point noise. */
export function gt(a: number, b: number): boolean {
  return a - b > margin(b);
}

/** a < b, ignoring floating-point noise. */
export function lt(a: number, b: number): boolean {
  return b - a > margin(b);
}

/** Whole units, halves rounded up (1.5 x 75 = 112.5 becomes 113). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + TOLERANCE);
}

export function mean(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
