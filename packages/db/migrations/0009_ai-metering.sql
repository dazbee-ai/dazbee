CREATE TABLE "ai_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"call_index" integer NOT NULL,
	"try" integer NOT NULL,
	"attempt" integer NOT NULL,
	"step" text NOT NULL,
	"model" text NOT NULL,
	"seller" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"seller_request_id" text,
	"usage" jsonb,
	"currency" text,
	"seller_cost" bigint,
	"reported_cost" bigint,
	"real_cost" bigint,
	"charge_cost" bigint,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"amount" bigint NOT NULL,
	"usage_rate" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"given_by" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_grants_amount" CHECK ("ai_grants"."amount" >= 0),
	CONSTRAINT "ai_grants_usage_rate" CHECK ("ai_grants"."usage_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"call_outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"job_id" text NOT NULL,
	"call_id" text,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prices" (
	"seller" text NOT NULL,
	"model" text NOT NULL,
	"unit" text NOT NULL,
	"currency" text NOT NULL,
	"price_per_million" bigint NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_prices_seller_model_unit_pk" PRIMARY KEY("seller","model","unit")
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"usage_rate" bigint NOT NULL,
	"spending_stop" bigint NOT NULL,
	"job_limit" integer NOT NULL,
	"layer_split_512" bigint NOT NULL,
	"layer_split_1024" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_one_row" CHECK ("ai_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "ai_step_models" (
	"step" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"rate" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_sellers" (
	"model" text NOT NULL,
	"seller" text NOT NULL,
	"position" integer NOT NULL,
	"seller_model" text,
	CONSTRAINT "model_sellers_model_seller_pk" PRIMARY KEY("model","seller")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_calls_try" ON "ai_calls" USING btree ("job_id","call_index","try");--> statement-breakpoint
CREATE INDEX "ai_calls_started" ON "ai_calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_calls_seller" ON "ai_calls" USING btree ("seller","started_at");--> statement-breakpoint
CREATE INDEX "ai_grants_workspace" ON "ai_grants" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_workspace" ON "ai_jobs" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "ai_ledger_grant" ON "ai_ledger" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "ai_ledger_job" ON "ai_ledger" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_ledger_one_charge" ON "ai_ledger" USING btree ("call_id","grant_id") WHERE "ai_ledger"."kind" = 'charge';--> statement-breakpoint
CREATE UNIQUE INDEX "model_sellers_position" ON "model_sellers" USING btree ("model","position");--> statement-breakpoint
CREATE FUNCTION "ai_ledger_add_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'ai_ledger rows are only ever added';
END
$$;--> statement-breakpoint
CREATE TRIGGER "ai_ledger_add_only" BEFORE UPDATE OR DELETE ON "ai_ledger" FOR EACH ROW EXECUTE FUNCTION "ai_ledger_add_only"();--> statement-breakpoint
INSERT INTO "ai_settings" ("id", "usage_rate", "spending_stop", "job_limit", "layer_split_512", "layer_split_1024")
VALUES (1, 1000000, 2000000000, 3, 1827272, 1827272);--> statement-breakpoint
INSERT INTO "currency_rates" ("currency", "rate") VALUES ('INR', 1000000), ('USD', 96172200);--> statement-breakpoint
INSERT INTO "ai_step_models" ("step", "model", "options") VALUES
	('round-plan', 'gpt-6-luna', '{}'),
	('read', 'gpt-6-luna', '{}'),
	('layer-plan', 'gpt-6.2-sol', '{}'),
	('draft-fast', 'muse-image-1.0', '{}'),
	('draft-precise', 'gpt-image-2.5-sunburst', '{"quality":"medium"}'),
	('refine', 'seedream-5.5', '{}'),
	('resize', 'seedream-5.5', '{}'),
	('layer-split', 'ming-image-0.1-design-layer', '{}');--> statement-breakpoint
INSERT INTO "model_sellers" ("model", "seller", "position") VALUES
	('gpt-image-2.5-sunburst', 'openai', 1),
	('gpt-image-2.5-sunburst', 'zenmux', 2),
	('gpt-6-luna', 'openai', 1),
	('gpt-6-luna', 'openrouter', 2),
	('gpt-6-luna', 'zenmux', 3),
	('gpt-6.2-sol', 'openai', 1),
	('gpt-6.2-sol', 'openrouter', 2),
	('gpt-6.2-sol', 'zenmux', 3),
	('muse-image-1.0', 'meta', 1),
	('muse-image-1.0', 'openrouter', 2),
	('muse-image-1.0', 'zenmux', 3),
	('seedream-5.5', 'openrouter', 1),
	('seedream-5.5', 'zenmux', 2),
	('seedream-5.5', 'pixazo', 3),
	('ming-image-0.1-design-layer', 'modal', 1);
