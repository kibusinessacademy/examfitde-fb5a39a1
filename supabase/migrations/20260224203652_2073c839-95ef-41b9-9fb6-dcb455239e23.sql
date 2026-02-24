-- Add action_verb_source for audit trail on AI-extracted verbs
ALTER TABLE public.competencies 
ADD COLUMN IF NOT EXISTS action_verb_source text DEFAULT 'unknown';

COMMENT ON COLUMN public.competencies.action_verb_source IS 'Source of action_verb: text_heuristic, whitelist, ai_verified, ai_unverified, manual, unknown';