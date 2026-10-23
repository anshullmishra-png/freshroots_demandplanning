ALTER TABLE "buying_decisions" ADD COLUMN "zoho_po_id" text;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD COLUMN "zoho_po_number" text;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD COLUMN "zoho_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD COLUMN "zoho_sent_by" integer;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD CONSTRAINT "buying_decisions_zoho_sent_by_users_id_fk" FOREIGN KEY ("zoho_sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;