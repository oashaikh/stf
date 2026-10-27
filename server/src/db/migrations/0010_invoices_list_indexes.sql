CREATE INDEX IF NOT EXISTS "invoices_user_created_idx" ON "invoices" ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_id_idx" ON "invoice_lines" ("invoice_id");
