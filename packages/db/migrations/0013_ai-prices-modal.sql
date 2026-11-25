-- Modal's published prices (read 25 Nov 2026), per million units in millionths of a US dollar: an H100 per
-- GPU-second, a physical CPU core per second and a GiB of memory per second, with no fee.
INSERT INTO "ai_prices" ("seller", "model", "unit", "currency", "price_per_million", "fee") VALUES
	('modal', 'ming-image-0.1-design-layer', 'gpu-second', 'USD', 1097000000, 0),
	('modal', 'ming-image-0.1-design-layer', 'cpu-core-second', 'USD', 13100000, 0),
	('modal', 'ming-image-0.1-design-layer', 'memory-gib-second', 'USD', 2220000, 0);
