import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { flags } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { daysBetween } from "@/lib/dates/isoWeek";
import { fastRules } from "./ai";
import { seedFiles, validate } from "./seed";
import { shiftSeed } from "./shiftSeed";
import { createTestDb, newSeedRun } from "./workflow";

// A date that is not the seed's own, in different weeks and years, around a year end, a leap day and an ISO week 53.
const DATES = ["2026-10-19", "2026-10-23", "2026-10-26", "2026-12-31", "2027-01-01", "2027-01-04", "2027-06-15", "2028-02-29", "2032-01-01"];
const at = (d: string) => new Date(`${d}T12:00:00+05:30`);

describe("shiftSeed", () => {
  it.each(DATES)("the seed moved to %s passes validation on that day with no errors", (d) => {
    const r = validate(shiftSeed(d), { now: at(d) });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("moving to the seed's own date changes nothing that matters", () => {
    const seed = seedFiles();
    const same = shiftSeed("2026-10-19");
    expect(same.sales.replace(/\r\n/g, "\n")).toBe(seed.sales.replace(/\r\n/g, "\n"));
    expect(same.inventory.replace(/\r\n/g, "\n")).toBe(seed.inventory.replace(/\r\n/g, "\n"));
    expect(same.sku_master).toBe(seed.sku_master);
    expect(same.distributor_master).toBe(seed.distributor_master);
  });

  it("without the shift the seed is stale a week later (so the shift is needed)", () => {
    const r = validate(seedFiles(), { now: at("2026-10-27") });
    expect(r.errors.map((e) => e.code)).toContain("STALE_INVENTORY");
  });

  it("quantities are untouched: only dates move", () => {
    const seed = seedFiles();
    const moved = shiftSeed("2027-03-10");
    const units = (t: string, col: number) => t.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(",")[col]);
    expect(units(moved.sales, 2)).toEqual(units(seed.sales, 2));
    expect(units(moved.sales, 0)).toEqual(units(seed.sales, 0));
    expect(units(moved.inventory, 2)).toEqual(units(seed.inventory, 2));
  });

  it("inventory is dated the new day, in the age limit", () => {
    const moved = shiftSeed("2026-11-09");
    const dates = new Set(moved.inventory.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(",")[3]));
    expect([...dates]).toEqual(["2026-11-09"]);
    expect(daysBetween("2026-11-09", "2026-11-09")).toBe(0);
  });

  it("the calendar covers the new year and the year either side, with the festival pattern kept", () => {
    const moved = shiftSeed("2027-03-10");
    const rows = moved.calendar.split(/\r?\n/).filter(Boolean);
    expect(rows).toHaveLength(1 + 36);
    expect(rows).toContain("2027,3,2027-03,TRUE"); // March is a festival month in the seed
    expect(rows).toContain("2026,1,2026-01,FALSE");
  });

  it("the as-of month keeps the seed's festival setting, so the uplift is the same", () => {
    const seedCal = seedFiles().calendar.split(/\r?\n/);
    const seedOct = seedCal.find((l) => l.startsWith("2026,10,"))!.split(",")[3];
    for (const [d, ym] of [["2027-02-15", "2027-02"], ["2026-12-31", "2026-12"], ["2027-06-15", "2027-06"]] as const) {
      const row = shiftSeed(d).calendar.split(/\r?\n/).find((l) => l.includes(`,${ym},`))!;
      expect(row.split(",")[3]).toBe(seedOct);
    }
  });

  it("rejects a bad date", () => {
    expect(() => shiftSeed("2026-13-40")).toThrow();
  });
});

describe("the shifted seed gives the same run", () => {
  let db: AnyDb;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it("the seed run flags 7 SKUs (the number the end-to-end test expects)", async () => {
    const run = await newSeedRun(db, { rules: fastRules() });
    expect(run.flagCount).toBe(7);
    expect(await db.select().from(flags).where(eq(flags.runId, run.runId))).toHaveLength(7);
  });

  it("the shifted data holds the same numbers as the seed, row for row, so the same 7 flags follow", () => {
    const rules = fastRules();
    const b = validate(seedFiles(), { now: at("2026-10-19"), rules }).data!;
    expect(b.sales.length).toBeGreaterThan(100);
    for (const d of ["2026-10-23", "2027-01-04", "2028-02-29"]) {
      const a = validate(shiftSeed(d), { now: at(d), rules }).data!;
      expect(a.sales.map((s) => [s.sku_id, s.units_sold])).toEqual(b.sales.map((s) => [s.sku_id, s.units_sold]));
      expect(a.inventory.map((i) => [i.sku_id, i.units_on_hand])).toEqual(b.inventory.map((i) => [i.sku_id, i.units_on_hand]));
    }
  });
});
