-- Each text step of the AI flow gets its model, reasoning effort and speed tier. GPT-6.1 Terra is priced as OpenAI,
-- OpenRouter and ZenMux list it (read 26 Nov 2026): US$1 input, US$0.05 cached input and US$5 output a million
-- tokens. OpenAI's fast tier costs twice its standard rates. Prices are per million tokens in millionths of a US
-- dollar. What an admin already set is kept: a price or a seller already listed, and a step's own row whose model
-- or options differ from the seeded ones. A step with no row of its own gets one only while the text default is
-- still GPT-6 Luna with no options.
INSERT INTO "ai_prices" ("seller", "model", "unit", "currency", "price_per_million", "fee") VALUES
	('openai', 'gpt-6.1-terra', 'input-token', 'USD', 1000000, 180000),
	('openai', 'gpt-6.1-terra', 'cached-input-token', 'USD', 50000, 180000),
	('openai', 'gpt-6.1-terra', 'output-token', 'USD', 5000000, 180000),
	('openai', 'gpt-6.1-terra', 'fast-input-token', 'USD', 2000000, 180000),
	('openai', 'gpt-6.1-terra', 'fast-cached-input-token', 'USD', 100000, 180000),
	('openai', 'gpt-6.1-terra', 'fast-output-token', 'USD', 10000000, 180000),
	('openai', 'gpt-6-luna', 'fast-input-token', 'USD', 200000, 180000),
	('openai', 'gpt-6-luna', 'fast-cached-input-token', 'USD', 20000, 180000),
	('openai', 'gpt-6-luna', 'fast-output-token', 'USD', 1000000, 180000),
	('openai', 'gpt-6.2-sol', 'fast-input-token', 'USD', 4000000, 180000),
	('openai', 'gpt-6.2-sol', 'fast-cached-input-token', 'USD', 200000, 180000),
	('openai', 'gpt-6.2-sol', 'fast-output-token', 'USD', 20000000, 180000),
	('zenmux', 'gpt-6.1-terra', 'input-token', 'USD', 1000000, 0),
	('zenmux', 'gpt-6.1-terra', 'cached-input-token', 'USD', 50000, 0),
	('zenmux', 'gpt-6.1-terra', 'output-token', 'USD', 5000000, 0),
	('openrouter', 'gpt-6.1-terra', 'input-token', 'USD', 1000000, 244900),
	('openrouter', 'gpt-6.1-terra', 'cached-input-token', 'USD', 50000, 244900),
	('openrouter', 'gpt-6.1-terra', 'output-token', 'USD', 5000000, 244900)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "model_sellers" ("model", "seller", "position", "seller_model") VALUES
	('gpt-6.1-terra', 'openai', 1, NULL),
	('gpt-6.1-terra', 'zenmux', 2, 'openai/gpt-6.1-terra'),
	('gpt-6.1-terra', 'openrouter', 3, 'openai/gpt-6.1-terra')
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "ai_step_models" SET "model" = 'gpt-6.1-terra', "options" = '{"effort":"low","tier":"standard"}', "updated_at" = now()
WHERE "step" = 'flow.round-plan-full' AND "model" = 'gpt-6.2-sol' AND "options" = '{}';--> statement-breakpoint
UPDATE "ai_step_models" SET "options" = '{"effort":"medium","tier":"standard"}', "updated_at" = now()
WHERE "step" = 'flow.layer-plan' AND "model" = 'gpt-6.2-sol' AND "options" = '{}';--> statement-breakpoint
UPDATE "ai_step_models" SET "options" = s."options"::jsonb, "updated_at" = now()
FROM (VALUES
	('flow.round-plan', '{"effort":"low","tier":"fast"}'),
	('flow.refine-plan', '{"effort":"low","tier":"fast"}'),
	('flow.reference-read', '{"effort":"low","tier":"fast"}'),
	('flow.read', '{"effort":"none","tier":"standard"}')
) AS s("step", "options")
WHERE "ai_step_models"."step" = s."step" AND "ai_step_models"."model" = 'gpt-6-luna' AND "ai_step_models"."options" = '{}';--> statement-breakpoint
INSERT INTO "ai_step_models" ("step", "model", "options")
SELECT s."step", 'gpt-6-luna', s."options"::jsonb
FROM (VALUES
	('flow.round-plan', '{"effort":"low","tier":"fast"}'),
	('flow.refine-plan', '{"effort":"low","tier":"fast"}'),
	('flow.reference-read', '{"effort":"low","tier":"fast"}'),
	('flow.read', '{"effort":"none","tier":"standard"}')
) AS s("step", "options")
WHERE EXISTS (SELECT 1 FROM "ai_kind_models" WHERE "kind" = 'text' AND "model" = 'gpt-6-luna' AND "options" = '{}')
ON CONFLICT ("step") DO NOTHING;
