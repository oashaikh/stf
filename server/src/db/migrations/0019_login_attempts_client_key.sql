ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "client_key" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_client_key_attempted_at_idx" ON "login_attempts" ("client_key","attempted_at");
