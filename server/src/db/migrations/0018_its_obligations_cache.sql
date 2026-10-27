CREATE TABLE IF NOT EXISTS "its_obligations_cache" (
	"user_id" uuid NOT NULL,
	"tax_year" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "its_obligations_cache_user_id_tax_year_pk" PRIMARY KEY("user_id","tax_year")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "its_obligations_cache" ADD CONSTRAINT "its_obligations_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
