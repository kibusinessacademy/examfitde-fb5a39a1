-- Cut B: Character-Variation pro Painpoint
-- Scenarios get optional painpoint_overrides: { [painpoint_key]: { tone_shift, pressure_level, tactic, line_template, state_deltas? } }
ALTER TABLE public.conversation_os_scenarios
  ADD COLUMN IF NOT EXISTS painpoint_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.conversation_os_scenarios.painpoint_overrides IS
  'Cut B: per-character override map. Keys = painpoint_key, value = partial character_reaction (tone_shift, pressure_level, tactic, line_template) + optional state_deltas. Merged on top of conversation_os_painpoint_graphs at runtime.';

-- Turn-level audit so we can see in debrief which character-variant fired
ALTER TABLE public.conversation_os_turns
  ADD COLUMN IF NOT EXISTS character_variant_applied boolean NOT NULL DEFAULT false;
