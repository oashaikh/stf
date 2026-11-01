CREATE TABLE IF NOT EXISTS "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"date" date NOT NULL,
	"amount_pence" integer NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"possible_duplicate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transactions_connection_provider_id_uidx" ON "bank_transactions" ("connection_id","provider_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_transactions_connection_date_idx" ON "bank_transactions" ("connection_id","date");
