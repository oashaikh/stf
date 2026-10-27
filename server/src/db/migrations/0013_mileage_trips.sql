DO $$ BEGIN
 CREATE TYPE "public"."mileage_vehicle_type" AS ENUM('car_van', 'motorcycle', 'bicycle');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mileage_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"from_place" text NOT NULL,
	"to_place" text NOT NULL,
	"purpose" text NOT NULL,
	"miles" integer NOT NULL,
	"vehicle_type" "mileage_vehicle_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "mileage_trips_miles_positive" CHECK ("mileage_trips"."miles" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mileage_trips_user_date_idx" ON "mileage_trips" ("user_id","date");
