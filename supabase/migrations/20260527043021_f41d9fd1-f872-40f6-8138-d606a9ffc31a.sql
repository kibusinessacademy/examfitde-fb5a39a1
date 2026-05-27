ALTER TABLE public.conversation_os_debriefs
ADD COLUMN IF NOT EXISTS dramaturgy_patterns jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.conversation_os_debriefs.dramaturgy_patterns IS
'Cut A — Eskalations-Kausalität. Array<{pattern_key, pattern_label, severity (low|medium|high), frequency, evidence_quotes:string[], state_impact:string, why_it_escalated:string, fix:string}>. Macht sichtbar WARUM eskaliert wurde, nicht nur DASS.';