ALTER TABLE "its_annual_submissions" ADD COLUMN IF NOT EXISTS "business_kind" text DEFAULT 'self-employment' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "its_annual_submissions" ADD CONSTRAINT "its_annual_submissions_business_kind_check" CHECK ("business_kind" IN ('self-employment', 'uk-property'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "its_annual_submissions" DROP CONSTRAINT IF EXISTS "its_annual_submissions_user_id_tax_year_sandbox_unique";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "its_annual_submissions" ADD CONSTRAINT "its_annual_submissions_user_year_sandbox_kind_unique" UNIQUE("user_id","tax_year","sandbox","business_kind");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
