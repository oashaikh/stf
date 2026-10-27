ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hmrc_its_business_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hmrc_scope" text;
