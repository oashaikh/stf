DO $$ BEGIN
 CREATE TYPE "public"."recurring_entry_kind" AS ENUM('income', 'expense');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."recurring_amount_basis" AS ENUM('gross', 'net');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."recurring_schedule" AS ENUM('monthly', 'yearly');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_entry_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "recurring_entry_kind" NOT NULL,
	"category_account_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"amount_is" "recurring_amount_basis" NOT NULL,
	"vat_rate_percent" integer,
	"description" text NOT NULL,
	"schedule" "recurring_schedule" NOT NULL,
	"anchor_day" integer NOT NULL,
	"next_date" date NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recurring_entry_templates_amount_positive" CHECK ("recurring_entry_templates"."amount_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_entry_runs" (
	"template_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_entry_runs_template_run_date_unique" UNIQUE("template_id","run_date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_entry_templates" ADD CONSTRAINT "recurring_entry_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_entry_templates" ADD CONSTRAINT "recurring_entry_templates_category_account_id_accounts_id_fk" FOREIGN KEY ("category_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_entry_runs" ADD CONSTRAINT "recurring_entry_runs_template_id_recurring_entry_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_entry_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_entry_runs" ADD CONSTRAINT "recurring_entry_runs_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_entry_templates_user_list_idx" ON "recurring_entry_templates" ("user_id","deleted_at","next_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_entry_templates_next_date_idx" ON "recurring_entry_templates" ("next_date");
