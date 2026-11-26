-- The fast tier's prices at OpenAI, and GPT-6.1 Terra's prices and sellers. Terra is priced as OpenAI, OpenRouter
-- and ZenMux list it (read 26 Nov 2026): US$1 input, US$0.05 cached input and US$5 output a million tokens.
-- OpenAI's fast tier costs twice its standard rates. Prices are per million tokens in millionths of a US dollar.
-- What an admin already set is kept: a price already listed, and Terra's sellers when it has any.
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
INSERT INTO "model_sellers" ("model", "seller", "position", "seller_model")
SELECT 'gpt-6.1-terra', s."seller", s."position", s."seller_model"
FROM (VALUES
	('openai', 1, NULL),
	('zenmux', 2, 'openai/gpt-6.1-terra'),
	('openrouter', 3, 'openai/gpt-6.1-terra')
) AS s("seller", "position", "seller_model")
WHERE NOT EXISTS (SELECT 1 FROM "model_sellers" WHERE "model" = 'gpt-6.1-terra');
