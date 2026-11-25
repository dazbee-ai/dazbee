-- Costs measured in the bill checks of 25 Nov 2026. The dollar is what the card was charged for a dollar top-up
-- (₹1,227 for US$12.74: ECB's ₹92.92 plus 3.65% for the bank's forex fee and its GST). The layer split's fixed
-- amounts are a warm split's GPU, CPU and memory cost at each size (₹2.31 and ₹0.57), rounded up towards the
-- loading time between splits. Meta bills this account in rupees and asks for a GST number it doesn't have, so
-- its GST counts as cost. Seedream's sellers go cheapest first: ZenMux charges no fee and nothing for reference
-- pictures, where OpenRouter's credit carries a 24.49% fee and GST; ZenMux also comes before OpenRouter as the
-- backup for GPT text and Muse.
UPDATE "currency_rates" SET "rate" = 96310000, "updated_at" = now() WHERE "currency" = 'USD';--> statement-breakpoint
UPDATE "ai_settings" SET "layer_split_1024" = 2500000, "layer_split_512" = 600000, "updated_at" = now() WHERE "id" = 1;--> statement-breakpoint
UPDATE "ai_prices" SET "fee" = 180000, "updated_at" = now() WHERE "seller" = 'meta';--> statement-breakpoint
UPDATE "model_sellers" SET "position" = -"position" WHERE "model" IN ('seedream-5.5', 'gpt-6-luna', 'gpt-6.2-sol', 'muse-image-1.0');--> statement-breakpoint
UPDATE "model_sellers" SET "position" = CASE "seller" WHEN 'zenmux' THEN 1 WHEN 'openrouter' THEN 2 WHEN 'pixazo' THEN 3 END WHERE "model" = 'seedream-5.5';--> statement-breakpoint
UPDATE "model_sellers" SET "position" = CASE "seller" WHEN 'openai' THEN 1 WHEN 'zenmux' THEN 2 WHEN 'openrouter' THEN 3 END WHERE "model" IN ('gpt-6-luna', 'gpt-6.2-sol');--> statement-breakpoint
UPDATE "model_sellers" SET "position" = CASE "seller" WHEN 'meta' THEN 1 WHEN 'zenmux' THEN 2 WHEN 'openrouter' THEN 3 END WHERE "model" = 'muse-image-1.0';
