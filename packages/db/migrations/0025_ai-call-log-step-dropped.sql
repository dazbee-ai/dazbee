-- The call log's "step" column goes: no build still serving declares it, so none names it in an insert or a read.
ALTER TABLE "ai_calls" DROP COLUMN IF EXISTS "step";
