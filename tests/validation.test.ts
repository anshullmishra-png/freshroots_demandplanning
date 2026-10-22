import { describe, expect, it } from "vitest";
import {
  NOW,
  appendLine,
  codes,
  removeLines,
  replaceOnce,
  seedFiles,
  validate,
  withRules,
} from "./helpers/seed";

const SKU001_W27 = "SKU001,2026-W27,194";

describe("seed data", () => {
  it("loads clean, with the expected shape", () => {
    const r = validate(seedFiles());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.fileStats).toEqual({ sales: 240, inventory: 15, sku_master: 15, distributor_master: 4, calendar: 24 });
    expect(r.data!.asOfDate).toBe("2026-10-19");
    expect(r.data!.lastCompleteWeek).toBe("2026-W42");
    expect(r.data!.sales).toHaveLength(240);
    expect(r.data!.skus.map((s) => s.sku_id)).toHaveLength(15);
    expect(r.data!.skusWithoutSales).toEqual([]);
  });

  it("raises one stock-vs-peak-sales warning on the seed: SKU006, about 26x its peak week", () => {
    const r = validate(seedFiles());
    expect(codes(r, "warnings")).toEqual(["STOCK_UNIT_MISMATCH"]);
    expect(r.warnings[0].message).toContain("SKU006 has 1100");
  });

  it("takes the warning multiple from config, not code", () => {
    const at = (m: number) =>
      withRules((c) => (c.data_guardrails.stock_vs_peak_weekly_sales_warning_multiple = m));
    expect(validate(seedFiles(), { rules: at(30) }).warnings).toEqual([]);
    expect(validate(seedFiles(), { rules: at(3) }).warnings).toHaveLength(13); // the value in the original docs
  });
});

describe("file-level errors", () => {
  it("blocks on a missing file and returns no data", () => {
    const r = validate({ ...seedFiles(), calendar: undefined });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("MISSING_FILE");
    expect(r.errors[0]).toMatchObject({ file: "calendar", code: "MISSING_FILE" });
    expect(r.data).toBeNull();
  });

  it("blocks on an empty file", () => {
    expect(codes(validate({ ...seedFiles(), inventory: "   \r\n" }))).toContain("MISSING_FILE");
  });

  it("blocks on a missing column and names it", () => {
    const f = seedFiles();
    f.sales = replaceOnce(f.sales, "Units_Sold", "Units");
    const r = validate(f);
    expect(r.errors).toContainEqual(expect.objectContaining({ file: "sales", code: "MISSING_COLUMN", column: "Units_Sold" }));
  });

  it("blocks a malformed row", () => {
    const f = seedFiles();
    f.sales = appendLine(f.sales, "SKU001,2026-W42,100,extra");
    expect(codes(validate(f))).toContain("MALFORMED_ROW");
  });

  it("enforces file size and row limits from config", () => {
    const tiny = withRules((c) => (c.data_guardrails.max_file_bytes = 100));
    expect(codes(validate(seedFiles(), { rules: tiny }))).toContain("FILE_TOO_LARGE");
    const fewRows = withRules((c) => (c.data_guardrails.max_rows_per_file = 10));
    expect(codes(validate(seedFiles(), { rules: fewRows }))).toContain("TOO_MANY_ROWS");
  });
});

describe("number and format errors", () => {
  it("blocks negative Units_Sold with file and row", () => {
    const f = seedFiles();
    f.sales = replaceOnce(f.sales, SKU001_W27, "SKU001,2026-W27,-4");
    const r = validate(f);
    expect(r.errors).toContainEqual(expect.objectContaining({ file: "sales", row: 2, code: "NEGATIVE_NUMBER" }));
  });

  it("blocks non-whole Units_Sold", () => {
    const f = seedFiles();
    f.sales = replaceOnce(f.sales, SKU001_W27, "SKU001,2026-W27,19.5");
    expect(codes(validate(f))).toContain("NOT_WHOLE_NUMBER");
  });

  it("blocks negative and non-whole Units_On_Hand", () => {
    const a = seedFiles();
    a.inventory = replaceOnce(a.inventory, "SKU001,Pune Central Warehouse,900", "SKU001,Pune Central Warehouse,-900");
    expect(codes(validate(a))).toContain("NEGATIVE_NUMBER");
    const b = seedFiles();
    b.inventory = replaceOnce(b.inventory, "SKU001,Pune Central Warehouse,900", "SKU001,Pune Central Warehouse,9e2");
    expect(codes(validate(b))).toContain("NOT_WHOLE_NUMBER");
  });

  it.each(["2026-27", "2026-W00", "2026-W54", "2025-W53", "W27", "2026-w27"])("blocks bad week format %s", (bad) => {
    const f = seedFiles();
    f.sales = replaceOnce(f.sales, SKU001_W27, `SKU001,${bad},194`);
    expect(codes(validate(f))).toContain("BAD_WEEK_FORMAT");
  });

  it.each(["0", "-5", "abc", "1.5", ""])("blocks Standard_Reorder_Qty %j", (bad) => {
    const f = seedFiles();
    f.sku_master = replaceOnce(f.sku_master, "Beverage,Low,500,Units", `Beverage,Low,${bad},Units`);
    expect(codes(validate(f))).toContain("BAD_QTY");
  });

  it.each(["Medium", "low", "HIGH", ""])("blocks Perishability %j", (bad) => {
    const f = seedFiles();
    f.sku_master = replaceOnce(f.sku_master, "Beverage,Low,500", `Beverage,${bad},500`);
    expect(codes(validate(f))).toContain("BAD_PERISHABILITY");
  });

  it("blocks an invalid As_Of_Date", () => {
    const f = seedFiles();
    f.inventory = replaceOnce(f.inventory, "SKU001,Pune Central Warehouse,900,2026-10-19", "SKU001,Pune Central Warehouse,900,2026-13-45");
    expect(codes(validate(f))).toContain("BAD_DATE");
  });

  it("blocks a bad festival flag and a bad month in the calendar", () => {
    const f = seedFiles();
    f.calendar = replaceOnce(f.calendar, "2026,10,2026-10,TRUE", "2026,10,2026-10,YES");
    f.calendar = replaceOnce(f.calendar, "2025,1,2025-01,FALSE", "2025,13,2025-13,FALSE");
    expect(new Set(codes(validate(f)))).toContain("BAD_BOOLEAN");
    expect(codes(validate(f))).toContain("BAD_MONTH");
  });
});

describe("key and reference errors", () => {
  it("blocks a duplicate (SKU_ID, Week) in sales", () => {
    const f = seedFiles();
    f.sales = appendLine(f.sales, "SKU001,2026-W42,100");
    expect(codes(validate(f))).toContain("DUPLICATE_KEY");
  });

  it("blocks duplicate keys in the master files, inventory and calendar", () => {
    const a = seedFiles();
    a.sku_master = appendLine(a.sku_master, "SKU001,Dup,Snack,Low,10,Units,DIST001");
    expect(codes(validate(a))).toContain("DUPLICATE_KEY");
    const b = seedFiles();
    b.distributor_master = appendLine(b.distributor_master, "DIST001,Dup,Maharashtra,Active");
    expect(codes(validate(b))).toContain("DUPLICATE_KEY");
    const c = seedFiles();
    c.inventory = appendLine(c.inventory, "SKU001,Pune Central Warehouse,10,2026-10-19");
    expect(codes(validate(c))).toContain("DUPLICATE_KEY");
    const d = seedFiles();
    d.calendar = appendLine(d.calendar, "2026,10,2026-10,TRUE");
    expect(codes(validate(d))).toContain("DUPLICATE_KEY");
  });

  it("blocks an unknown SKU in sales", () => {
    const f = seedFiles();
    f.sales = appendLine(f.sales, "SKU999,2026-W42,5");
    const r = validate(f);
    expect(r.errors).toContainEqual(expect.objectContaining({ file: "sales", code: "UNKNOWN_SKU" }));
  });

  it("blocks an unknown SKU in inventory", () => {
    const f = seedFiles();
    f.inventory = appendLine(f.inventory, "SKU999,Pune Central Warehouse,5,2026-10-19");
    const r = validate(f);
    expect(r.errors).toContainEqual(expect.objectContaining({ file: "inventory", code: "UNKNOWN_SKU" }));
  });

  it("blocks a SKU in the master that has no inventory row", () => {
    const f = seedFiles();
    f.inventory = removeLines(f.inventory, (l) => l.startsWith("SKU015,"));
    const r = validate(f);
    expect(r.errors).toContainEqual(expect.objectContaining({ file: "sku_master", code: "NO_INVENTORY_ROW" }));
  });

  it("blocks when the run month is missing from the calendar", () => {
    const f = seedFiles();
    f.calendar = removeLines(f.calendar, (l) => l.startsWith("2026,10,"));
    const r = validate(f);
    expect(r.errors).toContainEqual(expect.objectContaining({ file: "calendar", code: "CALENDAR_MONTH_MISSING" }));
  });
});

describe("history and freshness errors", () => {
  it("blocks a SKU with fewer than 12 weeks of sales", () => {
    const f = seedFiles();
    f.sales = removeLines(f.sales, (l) => /^SKU001,2026-W(2[7-9]|3[0-7]),/.test(l)); // leaves W38-W42 = 5 weeks
    const r = validate(f);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "FEWER_THAN_MIN_WEEKS" });
    expect(r.errors[0].message).toContain("SKU001 has 5 weeks");
  });

  it("takes the minimum weeks from config", () => {
    const rules = withRules((c) => (c.data_guardrails.min_weeks_of_sales_required = 17));
    expect(codes(validate(seedFiles(), { rules })).filter((c) => c === "FEWER_THAN_MIN_WEEKS")).toHaveLength(15);
  });

  it("blocks a gap inside the last 12 weeks", () => {
    const f = seedFiles();
    f.sales = removeLines(f.sales, (l) => l === "SKU001,2026-W35,185");
    const r = validate(f);
    expect(codes(r)).toEqual(["WEEK_GAP"]);
  });

  it("allows a gap older than the last 12 weeks", () => {
    const f = seedFiles();
    f.sales = removeLines(f.sales, (l) => l === SKU001_W27);
    expect(validate(f).ok).toBe(true);
  });

  it("blocks sales that stop before the last complete week", () => {
    const f = seedFiles();
    f.sales = removeLines(f.sales, (l) => l.startsWith("SKU002,2026-W42,"));
    const r = validate(f);
    expect(codes(r)).toEqual(["STALE_OR_FUTURE_SALES"]);
    expect(r.errors[0].message).toContain("SKU002 sales end at 2026-W41");
  });

  it("blocks sales that run past the last complete week (future data)", () => {
    const f = seedFiles();
    f.sales = appendLine(f.sales, "SKU001,2026-W43,100");
    expect(codes(validate(f))).toContain("STALE_OR_FUTURE_SALES");
  });

  it("blocks stale inventory: 7 days old passes, 8 days blocks", () => {
    expect(validate(seedFiles(), { now: new Date("2026-10-26T12:00:00+05:30") }).ok).toBe(true);
    const r = validate(seedFiles(), { now: new Date("2026-10-27T12:00:00+05:30") });
    expect(codes(r)).toEqual(["STALE_INVENTORY"]);
  });

  it("measures inventory age on the Asia/Kolkata day, not UTC", () => {
    // 2026-10-26 20:00 UTC is already 2026-10-27 in Kolkata: 8 days old.
    const r = validate(seedFiles(), { now: new Date("2026-10-26T20:00:00Z") });
    expect(codes(r)).toContain("STALE_INVENTORY");
  });

  it("takes the inventory age limit from config", () => {
    const rules = withRules((c) => (c.data_guardrails.max_inventory_age_days = 2));
    expect(codes(validate(seedFiles(), { now: new Date("2026-10-22T12:00:00+05:30"), rules }))).toEqual(["STALE_INVENTORY"]);
  });

  it("blocks inventory rows with different As_Of_Date values", () => {
    const f = seedFiles();
    f.inventory = replaceOnce(f.inventory, "SKU002,Pune Central Warehouse,1200,2026-10-19", "SKU002,Pune Central Warehouse,1200,2026-10-18");
    expect(codes(validate(f))).toContain("MIXED_AS_OF_DATES");
  });

  it("reports every problem, not just the first", () => {
    const f = seedFiles();
    f.sales = replaceOnce(f.sales, SKU001_W27, "SKU001,2026-W27,-4");
    f.sku_master = replaceOnce(f.sku_master, "Beverage,Low,500", "Beverage,Medium,500");
    f.inventory = removeLines(f.inventory, (l) => l.startsWith("SKU015,"));
    expect(new Set(codes(validate(f)))).toEqual(new Set(["NEGATIVE_NUMBER", "BAD_PERISHABILITY", "NO_INVENTORY_ROW"]));
  });
});

describe("cleaning", () => {
  it("reads CRLF, LF, BOM and padded cells to identical data", () => {
    const original = validate(seedFiles());
    const lf = seedFiles();
    const bom = seedFiles();
    const padded = seedFiles();
    for (const key of Object.keys(lf) as Array<keyof typeof lf>) {
      lf[key] = lf[key].replace(/\r\n/g, "\n");
      bom[key] = "﻿" + bom[key];
      padded[key] = padded[key].replace(/,/g, " , ");
    }
    expect(validate(lf).data).toEqual(original.data);
    expect(validate(bom).data).toEqual(original.data);
    expect(validate(padded).data).toEqual(original.data);
  });

  it("never repairs data: a bad value is reported, not fixed", () => {
    const f = seedFiles();
    f.sales = replaceOnce(f.sales, SKU001_W27, "SKU001,2026-W27,19.5");
    const r = validate(f);
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
  });
});

describe("warnings", () => {
  it("warns when a SKU sits under a distributor that is not Active, but still passes", () => {
    const f = seedFiles();
    f.distributor_master = replaceOnce(f.distributor_master, "DIST001,NutriFlow Distributors,Maharashtra,Active", "DIST001,NutriFlow Distributors,Maharashtra,Suspended");
    const r = validate(f);
    expect(r.ok).toBe(true);
    const hits = r.warnings.filter((w) => w.code === "DISTRIBUTOR_NOT_ACTIVE");
    expect(hits.map((w) => w.message.slice(0, 6))).toEqual(["SKU001", "SKU002", "SKU007", "SKU013"]);
  });

  it("warns about a zero-sales week inside the last 12, not outside it", () => {
    const inside = seedFiles();
    inside.sales = replaceOnce(inside.sales, "SKU001,2026-W40,267", "SKU001,2026-W40,0");
    const r = validate(inside);
    expect(r.ok).toBe(true);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: "ZERO_SALES_WEEK", file: "sales", row: 15 }));

    const outside = seedFiles();
    outside.sales = replaceOnce(outside.sales, SKU001_W27, "SKU001,2026-W27,0");
    expect(codes(validate(outside), "warnings")).not.toContain("ZERO_SALES_WEEK");
  });

  it("warns about a SKU with no sales at all, and lists it for the rule engine to skip", () => {
    const f = seedFiles();
    f.sales = removeLines(f.sales, (l) => l.startsWith("SKU015,"));
    const r = validate(f);
    expect(r.ok).toBe(true);
    expect(codes(r, "warnings")).toContain("NO_SALES_AT_ALL");
    expect(r.data!.skusWithoutSales).toEqual(["SKU015"]);
  });

  it("warns when stock is more than 15x the SKU's highest weekly sales", () => {
    const f = seedFiles();
    // SKU004 peak weekly sales is 86, so 15x is 1290.
    const edited = replaceOnce(f.inventory, "SKU004,Pune Central Warehouse,180", "SKU004,Pune Central Warehouse,1291");
    const r = validate({ ...f, inventory: edited });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.message.startsWith("SKU004 has 1291"))).toBe(true);
  });

  it("does not warn at exactly 15x the peak", () => {
    const f = seedFiles();
    f.inventory = replaceOnce(f.inventory, "SKU004,Pune Central Warehouse,180", "SKU004,Pune Central Warehouse,1290");
    expect(validate(f).warnings.some((w) => w.message.startsWith("SKU004"))).toBe(false);
  });
});

it("is deterministic: same input, identical output", () => {
  expect(JSON.stringify(validate(seedFiles()))).toBe(JSON.stringify(validate(seedFiles(), { now: NOW })));
});
