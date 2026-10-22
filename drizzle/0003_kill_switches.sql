CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."kill1_state" AS ENUM('armed', 'killed');--> statement-breakpoint
CREATE TYPE "public"."kill2_state" AS ENUM('green', 'alert', 'killed');--> statement-breakpoint
CREATE TYPE "public"."kill_event_type" AS ENUM('alert', 'killed', 'rearmed');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"to_email" text NOT NULL,
	"to_name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"kill_event_id" integer,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "kill_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "kill_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"switch" smallint NOT NULL,
	"event" "kill_event_type" NOT NULL,
	"metric_value" numeric(16, 4) NOT NULL,
	"threshold" numeric(16, 4) NOT NULL,
	"details_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kill_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"kill1_state" "kill1_state" DEFAULT 'armed' NOT NULL,
	"kill2_state" "kill2_state" DEFAULT 'green' NOT NULL,
	"kill1_epoch_start" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kill_state_single_row" CHECK ("kill_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "loss_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loss_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"stockout_loss_rupees" numeric(14, 2) NOT NULL,
	"overstock_writeoff_rupees" numeric(14, 2) NOT NULL,
	"entered_by" integer NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "loss_entries_period_unique" UNIQUE("period_start","period_end")
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kill_event_id_kill_events_id_fk" FOREIGN KEY ("kill_event_id") REFERENCES "public"."kill_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_events" ADD CONSTRAINT "kill_events_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_entries" ADD CONSTRAINT "loss_entries_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_entries" ADD CONSTRAINT "loss_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;