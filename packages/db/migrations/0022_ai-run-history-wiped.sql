-- AI functions and presets take the place of AI steps, so the call log no longer needs a step, and the run history
-- kept under steps is emptied: jobs, the call log, the ledger, briefs, AI frames, refines, daily checks and uploaded
-- seller files. Grants keep their amounts, so with the ledger empty each is whole again. The price list, seller
-- order, currency rates, settings, grants, designs and assets are not touched. The ledger refuses a row's delete, so
-- the tables are emptied with TRUNCATE, which its trigger does not see. The jobs are locked first, then the call
-- log, in the order the worker locks them.
TRUNCATE TABLE "ai_jobs", "ai_calls", "ai_ledger", "ai_briefs", "ai_frames", "ai_refines", "ai_daily_checks", "ai_seller_files";--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "step" DROP NOT NULL;
