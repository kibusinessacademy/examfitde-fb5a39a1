
ALTER TABLE public.verwaltung_oral_sessions
  ADD COLUMN IF NOT EXISTS voice_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_quality_gate_fails integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.verwaltung_persona_voice_id(_persona text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE COALESCE(_persona, 'buerger_neutral')
    WHEN 'buerger_neutral'           THEN 'nPczCjzI2devNBz1zQrb'
    WHEN 'buerger_aufgebracht'       THEN 'iP95p4xoKVk53GoZ742B'
    WHEN 'buerger_unsicher'          THEN 'XrExE9yKIg1WjnnlVkGX'
    WHEN 'buerger_juristisch'        THEN 'JBFqnCBsd6RMkjVDRZzb'
    WHEN 'antragsteller_familie'     THEN 'cgSgspJ2msm6clMCkdW9'
    WHEN 'antragsteller_unternehmer' THEN 'bIHbv24MWmeRgasZH58o'
    WHEN 'vorgesetzte_dezernent'     THEN 'onwK4e9ZLuTAKqWW03F9'
    WHEN 'kollege_kollegial'         THEN 'TX3LPaxmHKxFdv7VOQHJ'
    WHEN 'presse_kritisch'           THEN 'cjVigY5qzO86Huf0OWal'
    ELSE 'nPczCjzI2devNBz1zQrb'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.verwaltung_persona_voice_id(text) TO anon, authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('verwaltung_voice_tts_request',
   ARRAY['session_id','persona','voice_id','text_length','caller_role']::text[],
   'verwaltungsos.voice'),
  ('verwaltung_voice_stt_request',
   ARRAY['session_id','audio_bytes','transcript_length','caller_role']::text[],
   'verwaltungsos.voice'),
  ('verwaltung_voice_quality_gate_fail',
   ARRAY['session_id','reason','fails_total','caller_role']::text[],
   'verwaltungsos.voice')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module,
      updated_at    = now();
