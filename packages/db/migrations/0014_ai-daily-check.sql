CREATE TABLE "ai_daily_checks" (
	"seller" text NOT NULL,
	"day" text NOT NULL,
	"currency" text NOT NULL,
	"our_cost" bigint NOT NULL,
	"seller_cost" bigint,
	"outside_calls" bigint,
	"state" text NOT NULL,
	"source" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_daily_checks_seller_day_pk" PRIMARY KEY("seller","day")
);
--> statement-breakpoint
CREATE TABLE "ai_seller_files" (
	"id" text PRIMARY KEY NOT NULL,
	"seller" text NOT NULL,
	"name" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"currency" text NOT NULL,
	"days" jsonb NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_seller_files_seller" ON "ai_seller_files" USING btree ("seller","uploaded_at");