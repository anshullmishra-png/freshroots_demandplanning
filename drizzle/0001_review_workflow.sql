CREATE TYPE "public"."ai_decision_status" AS ENUM('pending_review', 'reviewed', 'voided_by_kill');--> statement-breakpoint
CREATE TYPE "public"."buying_status" AS ENUM('pending', 'placed', 'held', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."final_action" AS ENUM('REORDER', 'PAUSE_ORDER', 'NO_ACTION');--> statement-breakpoint
CREATE TYPE "public"."order_sink" AS ENUM('csv', 'zoho');--> statement-breakpoint
CREATE TYPE "public"."reason_code" AS ENUM('WRONG_QUANTITY', 'WRONG_ACTION', 'WRONG_FLAG', 'DATA_LOOKS_WRONG', 'MARKET_EVENT', 'NEW_LAUNCH_OR_DISTRIBUTOR_CHANGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."review_outcome" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."rule_action" AS ENUM('REORDER', 'PAUSE_ORDER');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('created', 'flagged', 'ai_done', 'in_review', 'completed', 'blocked');--> statement-breakpoint
CREATE TABLE "ai_decisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"flag_id" integer NOT NULL,
	"status" "ai_decision_status" DEFAULT 'pending_review' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"action" "rule_action" NOT NULL,
	"quantity" integer NOT NULL,
	"explanation" text NOT NULL,
	"confidence" "confidence",
	"needs_judgment" boolean NOT NULL,
	"judgment_note" text,
	"valid" boolean NOT NULL,
	"invalid_reasons" text[] NOT NULL,
	"is_fallback" boolean NOT NULL,
	"input_json" jsonb NOT NULL,
	"raw_response_json" text,
	"attempts_json" jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_decisions_flag_id_unique" UNIQUE("flag_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buying_decisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "buying_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"review_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"action" "final_action" NOT NULL,
	"quantity" integer NOT NULL,
	"sink" "order_sink" DEFAULT 'csv' NOT NULL,
	"sink_ref" text,
	"status" "buying_status" DEFAULT 'pending' NOT NULL,
	"placed_by" integer,
	"placed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buying_decisions_review_id_unique" UNIQUE("review_id")
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "flags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"flag_types" text[] NOT NULL,
	"avg_weekly_sales" numeric(14, 6) NOT NULL,
	"recent_avg" numeric(14, 6) NOT NULL,
	"demand_ratio" numeric(14, 6) NOT NULL,
	"uplift" numeric(14, 6) NOT NULL,
	"demand_rate" numeric(14, 6) NOT NULL,
	"units_on_hand" integer NOT NULL,
	"cover_weeks" numeric(14, 6) NOT NULL,
	"min_cover" numeric(14, 6) NOT NULL,
	"max_cover" numeric(14, 6) NOT NULL,
	"standard_qty" integer NOT NULL,
	"multiplier" numeric(14, 6) NOT NULL,
	"rule_action" "rule_action" NOT NULL,
	"rule_qty" integer NOT NULL,
	"needs_judgment" boolean NOT NULL,
	"judgment_reasons" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ai_decision_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"outcome" "review_outcome" NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"final_action" "final_action" NOT NULL,
	"final_qty" integer NOT NULL,
	"final_flag_types" text[] NOT NULL,
	"reason_code" "reason_code",
	"reason_text" text,
	CONSTRAINT "reviews_ai_decision_id_unique" UNIQUE("ai_decision_id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"snapshot_id" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rules_version" text NOT NULL,
	"rules_json" jsonb NOT NULL,
	"status" "run_status" DEFAULT 'created' NOT NULL,
	"kill_state_at_run" text,
	"summary_json" jsonb NOT NULL,
	"fallback_warning" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD CONSTRAINT "buying_decisions_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD CONSTRAINT "buying_decisions_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ai_decision_id_ai_decisions_id_fk" FOREIGN KEY ("ai_decision_id") REFERENCES "public"."ai_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flags_run_idx" ON "flags" USING btree ("run_id");