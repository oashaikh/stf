ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_transaction_id" uuid REFERENCES "public"."transactions"("id");
