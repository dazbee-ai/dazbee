-- OpenAI bills the input tokens a call writes to its prompt cache at 1.25 times the model's input price (its prompt
-- caching guide, read 27 Nov 2026). Each text model OpenAI is priced for gets that price, at the standard tier and
-- at the fast tier where it has one, worked out from the input price listed for it and rounded half up, with that
-- price's currency and fee. A text model is one priced in output tokens. A price already listed is kept.
INSERT INTO "ai_prices" ("seller", "model", "unit", "currency", "price_per_million", "fee")
SELECT
	p."seller",
	p."model",
	CASE p."unit" WHEN 'input-token' THEN 'cache-write-input-token' ELSE 'fast-cache-write-input-token' END,
	p."currency",
	(p."price_per_million" * 5 + 2) / 4,
	p."fee"
FROM "ai_prices" p
WHERE p."seller" = 'openai'
	AND p."unit" IN ('input-token', 'fast-input-token')
	AND EXISTS (
		SELECT 1 FROM "ai_prices" o
		WHERE o."seller" = p."seller" AND o."model" = p."model" AND o."unit" = 'output-token'
	)
ON CONFLICT DO NOTHING;
