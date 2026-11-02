CREATE TABLE IF NOT EXISTS "its_annual_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tax_year" text NOT NULL,
	"sandbox" boolean NOT NULL,
	"status" "its_submission_status" DEFAULT 'confirmed' NOT NULL,
	"confirmed_payload" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"hmrc_correlation_id" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "its_annual_submissions_user_id_tax_year_sandbox_unique" UNIQUE("user_id","tax_year","sandbox")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "its_annual_submissions" ADD CONSTRAINT "its_annual_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
