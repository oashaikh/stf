-- No grants: the columns sit on bank_transactions, which keeps its existing table-level access.
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "suggested_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "suggested_confidence" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_suggested_account_id_accounts_id_fk" FOREIGN KEY ("suggested_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_suggested_confidence_check" CHECK ("suggested_confidence" IS NULL OR "suggested_confidence" BETWEEN 0 AND 100);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
