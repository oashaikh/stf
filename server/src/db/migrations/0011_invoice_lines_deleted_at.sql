ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
