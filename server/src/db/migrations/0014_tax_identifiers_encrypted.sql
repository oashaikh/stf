ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utr_encrypted" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "nino_encrypted" text;
