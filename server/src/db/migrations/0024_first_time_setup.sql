ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "vat_registered" boolean;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "setup_skipped_steps" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "setup_finished_at" timestamp with time zone;
