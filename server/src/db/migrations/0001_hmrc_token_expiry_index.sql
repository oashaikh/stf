CREATE INDEX IF NOT EXISTS "users_hmrc_token_expires_at_idx" ON "users" ("hmrc_token_expires_at") WHERE "users"."hmrc_refresh_token" is not null;
