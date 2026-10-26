DO $$ BEGIN
 CREATE TYPE "public"."vat_submission_status" AS ENUM('pending', 'submitted', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vat_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"sandbox" boolean NOT NULL,
	"status" "vat_submission_status" DEFAULT 'pending' NOT NULL,
	"form_bundle_number" text,
	"processing_date" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_submissions_user_id_period_key_sandbox_unique" UNIQUE("user_id","period_key","sandbox")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vat_submissions" ADD CONSTRAINT "vat_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
