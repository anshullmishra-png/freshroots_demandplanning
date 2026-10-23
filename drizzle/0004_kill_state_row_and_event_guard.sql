-- The single kill_state row. Kill 1 starts counting from the moment the system goes live (docs/06-KILL-SWITCHES.md).
INSERT INTO "kill_state" ("id", "kill1_state", "kill2_state", "kill1_epoch_start")
VALUES (1, 'armed', 'green', now())
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Kill events are never deleted or edited (guardrail G-K4). The one allowed change is recording who first
-- acknowledged an event: acknowledged_by and acknowledged_at, once, and nothing else.
CREATE FUNCTION "kill_events_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on "kill_events" is not allowed: this table is append-only'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."acknowledged_by" IS NOT NULL
     OR (to_jsonb(NEW) - 'acknowledged_by' - 'acknowledged_at') IS DISTINCT FROM (to_jsonb(OLD) - 'acknowledged_by' - 'acknowledged_at') THEN
    RAISE EXCEPTION 'UPDATE on "kill_events" is not allowed: this table is append-only (only a first acknowledgement may be recorded)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "kill_events_guard" BEFORE UPDATE OR DELETE ON "kill_events"
  FOR EACH ROW EXECUTE FUNCTION "kill_events_guard"();
