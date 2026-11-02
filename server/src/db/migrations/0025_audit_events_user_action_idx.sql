CREATE INDEX IF NOT EXISTS "audit_events_user_action_occurred_idx" ON "audit_events" USING btree ("user_id","action","occurred_at");
