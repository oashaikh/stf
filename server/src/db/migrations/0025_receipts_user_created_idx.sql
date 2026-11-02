CREATE INDEX IF NOT EXISTS "receipts_user_created_idx" ON "receipts" ("user_id","created_at","id");
