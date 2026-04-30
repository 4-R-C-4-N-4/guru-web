-- 007_normalize_model_ids.sql — rename internal model ids to OpenRouter's
-- canonical (dotted) form so model_pricing.model_id and queries.model_used
-- match what /api/v1/models advertises.  todo:fbd30eff.
--
-- Only Sonnet diverged: 'anthropic/claude-sonnet-4-5' (our hyphenated alias)
-- → 'anthropic/claude-sonnet-4.5' (canonical).  DeepSeek's id is unchanged.

UPDATE model_pricing
SET model_id = 'anthropic/claude-sonnet-4.5'
WHERE model_id = 'anthropic/claude-sonnet-4-5';

UPDATE queries
SET model_used = 'anthropic/claude-sonnet-4.5'
WHERE model_used = 'anthropic/claude-sonnet-4-5';
