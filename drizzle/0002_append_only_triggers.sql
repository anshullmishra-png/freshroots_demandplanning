-- Append-only tables (guardrails G-H6 and G-M2, docs/03-DATA-SPEC.md): the database itself refuses to
-- change or delete a review or an audit entry, and never deletes an AI decision, whatever the application does.
CREATE FUNCTION "forbid_row_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "reviews_append_only" BEFORE UPDATE OR DELETE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION "forbid_row_change"();--> statement-breakpoint
CREATE TRIGGER "audit_log_append_only" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "forbid_row_change"();--> statement-breakpoint
CREATE TRIGGER "ai_decisions_no_delete" BEFORE DELETE ON "ai_decisions"
  FOR EACH ROW EXECUTE FUNCTION "forbid_row_change"();
