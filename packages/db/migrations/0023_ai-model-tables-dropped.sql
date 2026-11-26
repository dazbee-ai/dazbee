-- Every AI call is logged under its AI feature, AI function, preset and kind, so those four are required. A
-- call-log row with no AI function was logged under a step alone and is deleted first, with any row that lacks one
-- of the other three, which no build's worker logs. The call log's "step" column is left in place, unused and
-- allowed to be empty: the build still serving while this migration runs names it in its inserts. The two tables
-- of models, by kind and by step, go: a preset names each AI function's model.
DELETE FROM "ai_calls" WHERE "function" IS NULL OR "feature" IS NULL OR "preset" IS NULL OR "kind" IS NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "feature" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "function" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "preset" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
DROP TABLE "ai_kind_models";--> statement-breakpoint
DROP TABLE "ai_step_models";
