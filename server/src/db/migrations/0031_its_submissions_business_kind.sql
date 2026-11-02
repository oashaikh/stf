ALTER TABLE "its_submissions" ADD COLUMN IF NOT EXISTS "business_kind" text DEFAULT 'self-employment' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "its_submissions" ADD CONSTRAINT "its_submissions_business_kind_check" CHECK ("business_kind" IN ('self-employment', 'uk-property'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "its_submissions" DROP CONSTRAINT IF EXISTS "its_submissions_user_id_tax_year_quarter_sandbox_unique";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "its_submissions" ADD CONSTRAINT "its_submissions_user_period_sandbox_kind_unique" UNIQUE("user_id","tax_year","quarter","sandbox","business_kind");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
