CREATE TYPE "public"."perishability" AS ENUM('Low', 'High');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('raghav', 'procurement', 'priya', 'deepa', 'ceo', 'admin');--> statement-breakpoint
CREATE TABLE "calendar_months" (
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"is_festival" boolean NOT NULL,
	CONSTRAINT "calendar_months_year_month_pk" PRIMARY KEY("year","month")
);
--> statement-breakpoint
CREATE TABLE "data_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uploaded_by" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"as_of_date" date NOT NULL,
	"raw_files_json" jsonb NOT NULL,
	"validation_report_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"snapshot_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"location" text NOT NULL,
	"units_on_hand" integer NOT NULL,
	"as_of_date" date NOT NULL,
	CONSTRAINT "inventory_snapshot_id_sku_id_location_pk" PRIMARY KEY("snapshot_id","sku_id","location")
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"perishability" "perishability" NOT NULL,
	"standard_reorder_qty" integer NOT NULL,
	"uom" text NOT NULL,
	"distributor_id" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weekly_sales" (
	"snapshot_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"week" text NOT NULL,
	"units_sold" integer NOT NULL,
	CONSTRAINT "weekly_sales_snapshot_id_sku_id_week_pk" PRIMARY KEY("snapshot_id","sku_id","week")
);
--> statement-breakpoint
ALTER TABLE "data_snapshots" ADD CONSTRAINT "data_snapshots_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_sales" ADD CONSTRAINT "weekly_sales_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_snapshot_idx" ON "inventory" USING btree ("snapshot_id");