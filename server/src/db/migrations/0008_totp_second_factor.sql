ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret_encrypted" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_last_step" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_codes_user_id_code_hash_idx" ON "recovery_codes" ("user_id","code_hash");
