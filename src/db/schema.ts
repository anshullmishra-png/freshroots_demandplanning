// Database schema (Drizzle / Neon Postgres), per docs/03-DATA-SPEC.md.
// Kill-switch and loss tables are added in Phase 6, each phase with its own migration.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["raghav", "procurement", "priya", "deepa", "ceo", "admin"]);
export const perishability = pgEnum("perishability", ["Low", "High"]);
export const runStatus = pgEnum("run_status", ["created", "flagged", "ai_done", "in_review", "completed", "blocked"]);
export const aiDecisionStatus = pgEnum("ai_decision_status", ["pending_review", "reviewed", "voided_by_kill"]);
export const ruleAction = pgEnum("rule_action", ["REORDER", "PAUSE_ORDER"]);
export const finalAction = pgEnum("final_action", ["REORDER", "PAUSE_ORDER", "NO_ACTION"]);
export const confidence = pgEnum("confidence", ["LOW", "MEDIUM", "HIGH"]);
export const reviewOutcome = pgEnum("review_outcome", ["accepted", "rejected"]);
export const reasonCode = pgEnum("reason_code", [
  "WRONG_QUANTITY",
  "WRONG_ACTION",
  "WRONG_FLAG",
  "DATA_LOOKS_WRONG",
  "MARKET_EVENT",
  "NEW_LAUNCH_OR_DISTRIBUTOR_CHANGE",
  "OTHER",
]);
export const buyingStatus = pgEnum("buying_status", ["pending", "placed", "held", "cancelled"]);
export const orderSink = pgEnum("order_sink", ["csv", "zoho"]);
export const kill1State = pgEnum("kill1_state", ["armed", "killed"]);
export const kill2State = pgEnum("kill2_state", ["green", "alert", "killed"]);
export const killEventType = pgEnum("kill_event_type", ["alert", "killed", "rearmed"]);
export const emailStatus = pgEnum("email_status", ["queued", "sent", "failed"]);

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  // scrypt hash, never the password. Null means the account cannot sign in yet.
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every sign-in attempt, for brute-force protection (config/rules.json login_protection). The email is stored as typed
// (trimmed, lower case, cut to 200 characters), the IP as the host reports it. Never the password.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    emailKey: text("email_key").notNull(),
    ip: text("ip"),
    succeeded: boolean("succeeded").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_email_at").on(t.emailKey, t.at), index("login_attempts_ip_at").on(t.ip, t.at)],
);

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

export const runs = pgTable("runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => dataSnapshots.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rulesVersion: text("rules_version").notNull(),
  // The full config used, so any result can be reproduced (guardrail G-R3).
  rulesJson: jsonb("rules_json").notNull(),
  status: runStatus("status").notNull().default("created"),
  killStateAtRun: text("kill_state_at_run"),
  // Run context and the lists Raghav must see: as-of date, festival, unflagged and skipped SKUs.
  summaryJson: jsonb("summary_json").notNull(),
  fallbackWarning: boolean("fallback_warning").notNull().default(false),
});

const metric = (name: string) => numeric(name, { precision: 14, scale: 6, mode: "number" }).notNull();

export const flags = pgTable(
  "flags",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id),
    skuId: text("sku_id").notNull(),
    flagTypes: text("flag_types").array().notNull(),
    avgWeeklySales: metric("avg_weekly_sales"),
    recentAvg: metric("recent_avg"),
    demandRatio: metric("demand_ratio"),
    uplift: metric("uplift"),
    demandRate: metric("demand_rate"),
    unitsOnHand: integer("units_on_hand").notNull(),
    coverWeeks: metric("cover_weeks"),
    minCover: metric("min_cover"),
    maxCover: metric("max_cover"),
    standardQty: integer("standard_qty").notNull(),
    multiplier: metric("multiplier"),
    ruleAction: ruleAction("rule_action").notNull(),
    ruleQty: integer("rule_qty").notNull(),
    needsJudgment: boolean("needs_judgment").notNull(),
    judgmentReasons: text("judgment_reasons").array().notNull(),
  },
  (t) => [index("flags_run_idx").on(t.runId)],
);

export const aiDecisions = pgTable("ai_decisions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  flagId: integer("flag_id")
    .notNull()
    .unique()
    .references(() => flags.id),
  status: aiDecisionStatus("status").notNull().default("pending_review"),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  action: ruleAction("action").notNull(),
  quantity: integer("quantity").notNull(),
  explanation: text("explanation").notNull(),
  // Null on a fallback decision: the rule engine, not a model, produced it.
  confidence: confidence("confidence"),
  needsJudgment: boolean("needs_judgment").notNull(),
  judgmentNote: text("judgment_note"),
  valid: boolean("valid").notNull(),
  invalidReasons: text("invalid_reasons").array().notNull(),
  isFallback: boolean("is_fallback").notNull(),
  inputJson: jsonb("input_json").notNull(),
  rawResponseJson: text("raw_response_json"),
  attemptsJson: jsonb("attempts_json").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only: a database trigger refuses UPDATE and DELETE (guardrail G-H6).
export const reviews = pgTable("reviews", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  aiDecisionId: integer("ai_decision_id")
    .notNull()
    .unique()
    .references(() => aiDecisions.id),
  reviewerId: integer("reviewer_id")
    .notNull()
    .references(() => users.id),
  outcome: reviewOutcome("outcome").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  finalAction: finalAction("final_action").notNull(),
  finalQty: integer("final_qty").notNull(),
  finalFlagTypes: text("final_flag_types").array().notNull(),
  reasonCode: reasonCode("reason_code"),
  reasonText: text("reason_text"),
});

export const buyingDecisions = pgTable("buying_decisions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Not null and unique: a buying decision can only exist for one review (guardrail G-B1).
  reviewId: integer("review_id")
    .notNull()
    .unique()
    .references(() => reviews.id),
  skuId: text("sku_id").notNull(),
  action: finalAction("action").notNull(),
  quantity: integer("quantity").notNull(),
  sink: orderSink("sink").notNull().default("csv"),
  sinkRef: text("sink_ref"),
  status: buyingStatus("status").notNull().default("pending"),
  placedBy: integer("placed_by").references(() => users.id),
  placedAt: timestamp("placed_at", { withTimezone: true }),
  // The draft purchase order made in Zoho Inventory for this decision (null until sent). The system only ever drafts;
  // procurement issues the order in Zoho (guardrail G-B3).
  zohoPoId: text("zoho_po_id"),
  zohoPoNumber: text("zoho_po_number"),
  zohoSentAt: timestamp("zoho_sent_at", { withTimezone: true }),
  zohoSentBy: integer("zoho_sent_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only: a database trigger refuses UPDATE and DELETE.
export const auditLog = pgTable("audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actorId: integer("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const rupees = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

// Priya's figures, in rupees (docs/09). The app never computes them. Each period sits inside one calendar quarter.
export const lossEntries = pgTable(
  "loss_entries",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    stockoutLossRupees: rupees("stockout_loss_rupees").notNull(),
    overstockWriteoffRupees: rupees("overstock_writeoff_rupees").notNull(),
    enteredBy: integer("entered_by")
      .notNull()
      .references(() => users.id),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [unique("loss_entries_period_unique").on(t.periodStart, t.periodEnd)],
);

// One row only. Kill 1 and Kill 2 state, and when Kill 1 started counting.
export const killState = pgTable(
  "kill_state",
  {
    id: integer("id").primaryKey().default(1),
    kill1State: kill1State("kill1_state").notNull().default("armed"),
    kill2State: kill2State("kill2_state").notNull().default("green"),
    kill1EpochStart: timestamp("kill1_epoch_start", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("kill_state_single_row", sql`${t.id} = 1`)],
);

// Append-only. A trigger allows one thing only: recording the first acknowledgement (guardrail G-K4).
export const killEvents = pgTable("kill_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  killSwitch: smallint("switch").notNull(),
  event: killEventType("event").notNull(),
  metricValue: numeric("metric_value", { precision: 16, scale: 4, mode: "number" }).notNull(),
  threshold: numeric("threshold", { precision: 16, scale: 4, mode: "number" }).notNull(),
  detailsJson: jsonb("details_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

// Alert and kill emails, queued in the same transaction as the event that caused them, then delivered.
export const emailOutbox = pgTable("email_outbox", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  toEmail: text("to_email").notNull(),
  toName: text("to_name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull(),
  killEventId: integer("kill_event_id").references(() => killEvents.id),
  status: emailStatus("status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
});
