-- The layer split's fixed charge covers a lone split on Modal, its container's start from a snapshot and its wait
-- included, as measured on 26 Nov 2026 (docs/research/ai-flow-image-models.md): ₹6.00 at 1024 px and ₹3.50 at
-- 512 px. A charge an admin has set to another amount is left as it is.
UPDATE "ai_settings" SET "layer_split_1024" = 6000000 WHERE "layer_split_1024" = 2500000;--> statement-breakpoint
UPDATE "ai_settings" SET "layer_split_512" = 3500000 WHERE "layer_split_512" = 600000;
