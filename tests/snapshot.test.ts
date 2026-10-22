import { PGlite } from "@electric-sql/pglite";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgTable } from "drizzle-orm/pg-core";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { latestMasterFiles, storeSnapshot } from "@/db/snapshots";
import * as schema from "@/db/schema";
import { removeLines, seedFiles, validate } from "./helpers/seed";

// A real in-memory Postgres, with the generated migration applied, so the schema is exercised for real.
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
}, 60_000);

async function rows() {
  const n = async (t: PgTable) => (await db.select({ n: count() }).from(t))[0].n;
  return {
    snapshots: await n(schema.dataSnapshots),
    sales: await n(schema.weeklySales),
    inventory: await n(schema.inventory),
    skus: await n(schema.skus),
    distributors: await n(schema.distributors),
    calendar: await n(schema.calendarMonths),
  };
}

describe("storeSnapshot", () => {
  it("stores the seed as a snapshot with raw files, sales, inventory and masters", async () => {
    const files = seedFiles();
    const result = validate(files);
    const { snapshotId } = await storeSnapshot(db, { uploadedBy: null, files, result });
    expect(snapshotId).toBeGreaterThan(0);
    expect(await rows()).toEqual({ snapshots: 1, sales: 240, inventory: 15, skus: 15, distributors: 4, calendar: 24 });

    const [snap] = await db.select().from(schema.dataSnapshots);
    expect(snap.asOfDate).toBe("2026-10-19");
    expect(snap.rawFilesJson).toEqual(files); // raw files kept for audit (G-D5)
    expect((snap.validationReportJson as { warnings: unknown[] }).warnings).toHaveLength(1);
  }, 60_000);

  it("keeps master data current on a second upload without duplicating it", async () => {
    const files = seedFiles();
    await storeSnapshot(db, { uploadedBy: null, files, result: validate(files) });
    await storeSnapshot(db, { uploadedBy: null, files, result: validate(files) });
    expect(await rows()).toEqual({ snapshots: 2, sales: 480, inventory: 30, skus: 15, distributors: 4, calendar: 24 });
  }, 60_000);

  it("offers the previous master files for 'use previous master files'", async () => {
    expect(await latestMasterFiles(db)).toEqual({});
    const files = seedFiles();
    await storeSnapshot(db, { uploadedBy: null, files, result: validate(files) });
    const previous = await latestMasterFiles(db);
    expect(previous).toEqual({
      sku_master: files.sku_master,
      distributor_master: files.distributor_master,
      calendar: files.calendar,
    });
    // A new upload with only sales and inventory, plus the previous masters, validates.
    const next = { ...previous, sales: files.sales, inventory: files.inventory };
    expect(validate(next).ok).toBe(true);
  }, 60_000);

  it("refuses an upload with errors and writes nothing (G-D1)", async () => {
    const files = seedFiles();
    files.inventory = removeLines(files.inventory, (l) => l.startsWith("SKU015,"));
    const result = validate(files);
    expect(result.ok).toBe(false);
    await expect(storeSnapshot(db, { uploadedBy: null, files, result })).rejects.toThrow(/validation errors/);
    expect(await rows()).toEqual({ snapshots: 0, sales: 0, inventory: 0, skus: 0, distributors: 0, calendar: 0 });
  }, 60_000);

  it("rolls everything back if a write fails part-way", async () => {
    const files = seedFiles();
    const result = validate(files);
    result.data!.sales.push({ ...result.data!.sales[0] }); // duplicate primary key, fails at the sales insert
    await expect(storeSnapshot(db, { uploadedBy: null, files, result })).rejects.toThrow();
    expect(await rows()).toEqual({ snapshots: 0, sales: 0, inventory: 0, skus: 0, distributors: 0, calendar: 0 });
  }, 60_000);
});
