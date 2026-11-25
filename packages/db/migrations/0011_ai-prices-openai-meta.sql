-- OpenAI's and Meta's published prices (read 25 Nov 2026), per million units in millionths of a US dollar.
-- OpenAI's bill adds 18% GST. Meta's Muse Image is a flat price per picture made.
INSERT INTO "ai_prices" ("seller", "model", "unit", "currency", "price_per_million", "fee") VALUES
	('openai', 'gpt-6-luna', 'input-token', 'USD', 100000, 180000),
	('openai', 'gpt-6-luna', 'cached-input-token', 'USD', 10000, 180000),
	('openai', 'gpt-6-luna', 'output-token', 'USD', 500000, 180000),
	('openai', 'gpt-6.2-sol', 'input-token', 'USD', 2000000, 180000),
	('openai', 'gpt-6.2-sol', 'cached-input-token', 'USD', 100000, 180000),
	('openai', 'gpt-6.2-sol', 'output-token', 'USD', 10000000, 180000),
	('openai', 'gpt-image-2.5-sunburst', 'input-token', 'USD', 5000000, 180000),
	('openai', 'gpt-image-2.5-sunburst', 'image-input-token', 'USD', 8000000, 180000),
	('openai', 'gpt-image-2.5-sunburst', 'image-output-token', 'USD', 30000000, 180000),
	('meta', 'muse-image-1.0', 'picture', 'USD', 10000000000, 0);
