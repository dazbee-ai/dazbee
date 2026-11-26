ALTER TABLE "ai_jobs" ADD COLUMN "finish_holder" text;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "finish_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ai_jobs_member" ON "ai_jobs" USING btree ("member_id","created_at");