-- No grants: the columns sit on receipts, which keeps its existing table-level access.
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "file_hash" text;
--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "duplicate_of_receipt_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_user_file_hash_idx" ON "receipts" ("user_id","file_hash");
