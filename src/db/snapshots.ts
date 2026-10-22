import { desc, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { FILE_KEYS, type FileKey, type UploadFiles, type ValidationResult } from "@/lib/validation/types";
import { calendarMonths, dataSnapshots, distributors, inventory, skus, weeklySales } from "./schema";

// Any Drizzle Postgres database: Neon in production, PGlite in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PgDatabase<any, any, any>;

const INSERT_CHUNK = 5000;

// The value proposed for insert, used by ON CONFLICT DO UPDATE.
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) out.push(rows.slice(i, i + INSERT_CHUNK));
  return out;
}

/**
 * Stores a validated upload as an immutable data snapshot and refreshes the master tables.
 * Refuses anything with a validation error (guardrail G-D1): nothing is written.
 * The whole write happens in one transaction, so a failure leaves no partial snapshot.
 */
export async function storeSnapshot(
  db: AnyDb,
  input: { uploadedBy: number | null; files: Record<FileKey, string>; result: ValidationResult },
): Promise<{ snapshotId: number }> {
  const { result, files, uploadedBy } = input;
  if (!result.ok || !result.data) {
    throw new Error("Cannot store a snapshot: the upload has validation errors.");
  }
  const data = result.data;

  return db.transaction(async (tx) => {
    for (const rows of chunks(data.distributors)) {
      await tx
        .insert(distributors)
        .values(rows.map((d) => ({ distributorId: d.distributor_id, name: d.name, region: d.region, status: d.status })))
        .onConflictDoUpdate({
          target: distributors.distributorId,
          set: {
            name: sqlExcluded("name"),
            region: sqlExcluded("region"),
            status: sqlExcluded("status"),
          },
        });
    }
    for (const rows of chunks(data.skus)) {
      await tx
        .insert(skus)
        .values(
          rows.map((s) => ({
            skuId: s.sku_id,
            name: s.name,
            category: s.category,
            perishability: s.perishability,
            standardReorderQty: s.standard_reorder_qty,
            uom: s.uom,
            distributorId: s.distributor_id,
          })),
        )
        .onConflictDoUpdate({
          target: skus.skuId,
          set: {
            name: sqlExcluded("name"),
            category: sqlExcluded("category"),
            perishability: sqlExcluded("perishability"),
            standardReorderQty: sqlExcluded("standard_reorder_qty"),
            uom: sqlExcluded("uom"),
            distributorId: sqlExcluded("distributor_id"),
          },
        });
    }
    for (const rows of chunks(data.calendar)) {
      await tx
        .insert(calendarMonths)
        .values(rows.map((c) => ({ year: c.year, month: c.month, isFestival: c.is_festival })))
        .onConflictDoUpdate({
          target: [calendarMonths.year, calendarMonths.month],
          set: { isFestival: sqlExcluded("is_festival") },
        });
    }

    const [snapshot] = await tx
      .insert(dataSnapshots)
      .values({
        uploadedBy,
        asOfDate: data.asOfDate,
        rawFilesJson: files,
        validationReportJson: { errors: result.errors, warnings: result.warnings, fileStats: result.fileStats },
      })
      .returning({ id: dataSnapshots.id });

    for (const rows of chunks(data.sales)) {
      await tx
        .insert(weeklySales)
        .values(rows.map((s) => ({ snapshotId: snapshot.id, skuId: s.sku_id, week: s.week, unitsSold: s.units_sold })));
    }
    for (const rows of chunks(data.inventory)) {
      await tx.insert(inventory).values(
        rows.map((i) => ({
          snapshotId: snapshot.id,
          skuId: i.sku_id,
          location: i.location,
          unitsOnHand: i.units_on_hand,
          asOfDate: i.as_of_date,
        })),
      );
    }
    return { snapshotId: snapshot.id };
  });
}

/** Raw master files from the most recent snapshot, for the "use previous master files" option. */
export async function latestMasterFiles(db: AnyDb): Promise<UploadFiles> {
  const [latest] = await db
    .select({ raw: dataSnapshots.rawFilesJson })
    .from(dataSnapshots)
    .orderBy(desc(dataSnapshots.id))
    .limit(1);
  if (!latest) return {};
  const raw = latest.raw as Partial<Record<FileKey, string>>;
  const out: UploadFiles = {};
  for (const key of FILE_KEYS) {
    if (key === "sku_master" || key === "distributor_master" || key === "calendar") out[key] = raw[key];
  }
  return out;
}
