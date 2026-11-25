CREATE TABLE "ai_kind_models" (
	"kind" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "ai_kind_models" ("kind", "model", "options") VALUES
	('text', 'gpt-6-luna', '{}'),
	('picture', 'muse-image-1.0', '{}'),
	('layer-split', 'ming-image-0.1-design-layer', '{}');--> statement-breakpoint
INSERT INTO "ai_step_models" ("step", "model", "options", "updated_at")
SELECT 'flow.' || s."step", s."model", s."options", s."updated_at"
FROM "ai_step_models" s
JOIN (VALUES
	('round-plan', 'text'),
	('read', 'text'),
	('layer-plan', 'text'),
	('draft-fast', 'picture'),
	('draft-precise', 'picture'),
	('refine', 'picture'),
	('resize', 'picture'),
	('layer-split', 'layer-split')
) AS k("step", "kind") ON k."step" = s."step"
JOIN "ai_kind_models" d ON d."kind" = k."kind"
WHERE s."model" <> d."model" OR s."options" <> d."options"
ON CONFLICT ("step") DO NOTHING;--> statement-breakpoint
UPDATE "ai_calls" SET "step" = 'flow.' || "step"
WHERE "step" IN ('round-plan', 'read', 'layer-plan', 'draft-fast', 'draft-precise', 'refine', 'resize', 'layer-split');
