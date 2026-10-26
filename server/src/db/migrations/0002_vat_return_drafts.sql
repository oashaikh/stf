DO $$ BEGIN
 CREATE TYPE "public"."vat_return_draft_status" AS ENUM('draft', 'confirmed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vat_return_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "vat_return_draft_status" DEFAULT 'draft' NOT NULL,
	"box1_pence" integer NOT NULL,
	"box2_pence" integer NOT NULL,
	"box3_pence" integer NOT NULL,
	"box4_pence" integer NOT NULL,
	"box5_pence" integer NOT NULL,
	"box6_pence" integer NOT NULL,
	"box7_pence" integer NOT NULL,
	"box8_pence" integer NOT NULL,
	"box9_pence" integer NOT NULL,
	"declaration_accepted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_return_drafts_user_id_period_key_unique" UNIQUE("user_id","period_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vat_return_drafts" ADD CONSTRAINT "vat_return_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
