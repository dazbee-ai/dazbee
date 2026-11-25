DELETE FROM "ai_step_models"
WHERE "step" IN ('round-plan', 'read', 'layer-plan', 'draft-fast', 'draft-precise', 'refine', 'resize', 'layer-split');
