CREATE INDEX IF NOT EXISTS "transactions_user_date_idx" ON "transactions" ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_lines_transaction_id_idx" ON "transaction_lines" ("transaction_id");
