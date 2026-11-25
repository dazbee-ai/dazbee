-- OpenRouter's, ZenMux's and Pixazo's published prices (read 25 Nov 2026), per million units in millionths of a
-- US dollar. OpenRouter adds 5.5% when credit is bought. Seedream 5.5 is a price per picture made up to 2.6 MP
-- and per reference picture (ZenMux lists one but charges none, as its logs show); Muse Image a price per picture
-- made. OpenRouter lists no seller of Muse Image yet.
INSERT INTO "ai_prices" ("seller", "model", "unit", "currency", "price_per_million", "fee") VALUES
	('openrouter', 'gpt-6-luna', 'input-token', 'USD', 100000, 55000),
	('openrouter', 'gpt-6-luna', 'cached-input-token', 'USD', 10000, 55000),
	('openrouter', 'gpt-6-luna', 'output-token', 'USD', 500000, 55000),
	('openrouter', 'gpt-6.2-sol', 'input-token', 'USD', 2000000, 55000),
	('openrouter', 'gpt-6.2-sol', 'cached-input-token', 'USD', 100000, 55000),
	('openrouter', 'gpt-6.2-sol', 'output-token', 'USD', 10000000, 55000),
	('openrouter', 'seedream-5.5', 'picture', 'USD', 20000000000, 55000),
	('openrouter', 'seedream-5.5', 'reference-picture', 'USD', 8000000000, 55000),
	('zenmux', 'gpt-6-luna', 'input-token', 'USD', 100000, 0),
	('zenmux', 'gpt-6-luna', 'cached-input-token', 'USD', 10000, 0),
	('zenmux', 'gpt-6-luna', 'output-token', 'USD', 500000, 0),
	('zenmux', 'gpt-6.2-sol', 'input-token', 'USD', 2000000, 0),
	('zenmux', 'gpt-6.2-sol', 'cached-input-token', 'USD', 100000, 0),
	('zenmux', 'gpt-6.2-sol', 'output-token', 'USD', 10000000, 0),
	('zenmux', 'gpt-image-2.5-sunburst', 'input-token', 'USD', 5000000, 0),
	('zenmux', 'gpt-image-2.5-sunburst', 'image-input-token', 'USD', 8000000, 0),
	('zenmux', 'gpt-image-2.5-sunburst', 'image-output-token', 'USD', 30000000, 0),
	('zenmux', 'muse-image-1.0', 'picture', 'USD', 10000000000, 0),
	('zenmux', 'seedream-5.5', 'picture', 'USD', 20000000000, 0),
	('zenmux', 'seedream-5.5', 'reference-picture', 'USD', 0, 0),
	('pixazo', 'seedream-5.5', 'picture', 'USD', 20000000000, 0),
	('pixazo', 'seedream-5.5', 'reference-picture', 'USD', 8000000000, 0);--> statement-breakpoint
-- Each seller's own name for the models it sells.
UPDATE "model_sellers" SET "seller_model" = 'openai/' || "model" WHERE "seller" IN ('openrouter', 'zenmux') AND "model" IN ('gpt-6-luna', 'gpt-6.2-sol', 'gpt-image-2.5-sunburst');--> statement-breakpoint
UPDATE "model_sellers" SET "seller_model" = 'meta/muse-image' WHERE "seller" = 'openrouter' AND "model" = 'muse-image-1.0';--> statement-breakpoint
UPDATE "model_sellers" SET "seller_model" = 'meta/muse-image-1.0' WHERE "seller" = 'zenmux' AND "model" = 'muse-image-1.0';--> statement-breakpoint
UPDATE "model_sellers" SET "seller_model" = 'bytedance-seed/seedream-5-5' WHERE "seller" = 'openrouter' AND "model" = 'seedream-5.5';--> statement-breakpoint
UPDATE "model_sellers" SET "seller_model" = 'bytedance/doubao-seedream-5.5' WHERE "seller" = 'zenmux' AND "model" = 'seedream-5.5';--> statement-breakpoint
UPDATE "model_sellers" SET "seller_model" = 'seedream-5-5' WHERE "seller" = 'pixazo' AND "model" = 'seedream-5.5';
