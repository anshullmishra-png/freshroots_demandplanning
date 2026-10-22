// Database schema (Drizzle / Neon Postgres), per docs/03-DATA-SPEC.md.
// Phase 1 covers users, master data and data snapshots. Run, flag, AI, review, buying
// and kill tables are added in the phases that use them, each with its own migration.
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["raghav", "procurement", "priya", "deepa", "ceo", "admin"]);
export const perishability = pgEnum("perishability", ["Low", "High"]);

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const distributors = pgTable("distributors", {
  distributorId: text("distributor_id").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  status: text("status").notNull(),
});

export const skus = pgTable("skus", {
  skuId: text("sku_id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  perishability: perishability("perishability").notNull(),
  standardReorderQty: integer("standard_reorder_qty").notNull(),
  uom: text("uom").notNull(),
  // Information only; not used in any calculation (open question 16).
  distributorId: text("distributor_id"),
});

export const calendarMonths = pgTable(
  "calendar_months",
  {
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    isFestival: boolean("is_festival").notNull(),
  },
  (t) => [primaryKey({ columns: [t.year, t.month] })],
);

export const dataSnapshots = pgTable("data_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Null for snapshots loaded by the seed script (no signed-in user).
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  asOfDate: date("as_of_date", { mode: "string" }).notNull(),
  // The five raw files as uploaded (guardrail G-D5), so any result can be reproduced.
  rawFilesJson: jsonb("raw_files_json").notNull(),
  validationReportJson: jsonb("validation_report_json").notNull(),
});

export const weeklySales = pgTable(
  "weekly_sales",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => dataSnapshots.id),
    skuId: text("sku_id").notNull(),
    week: text("week").notNull(),
    unitsSold: integer("units_sold").notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.skuId, t.week] })],
);

export const inventory = pgTable(
  "inventory",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => dataSnapshots.id),
    skuId: text("sku_id").notNull(),
    location: text("location").notNull(),
    unitsOnHand: integer("units_on_hand").notNull(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.skuId, t.location] }),
    index("inventory_snapshot_idx").on(t.snapshotId),
  ],
);
