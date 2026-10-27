DO $$ BEGIN
 CREATE TYPE "public"."trading_allowance_method" AS ENUM('actual', 'allowance');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trading_allowance_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tax_year" text NOT NULL,
	"method" "trading_allowance_method" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_allowance_choices_user_id_tax_year_unique" UNIQUE("user_id","tax_year")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trading_allowance_choices" ADD CONSTRAINT "trading_allowance_choices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
