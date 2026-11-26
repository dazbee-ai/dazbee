CREATE TABLE "ai_picks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"function" text NOT NULL,
	"mode" text DEFAULT '' NOT NULL,
	"preset" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "feature" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "function" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "preset" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "prompt_hash" text;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "presets" jsonb;--> statement-breakpoint
CREATE INDEX "ai_picks_function" ON "ai_picks" USING btree ("function","mode","id");--> statement-breakpoint
CREATE INDEX "ai_calls_preset" ON "ai_calls" USING btree ("function","preset","ended_at");