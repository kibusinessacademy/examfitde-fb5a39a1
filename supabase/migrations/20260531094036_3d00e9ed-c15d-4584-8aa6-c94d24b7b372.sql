CREATE OR REPLACE FUNCTION public.fn_oral_examiner_voice_id(
  _examiner_mode text,
  _stress_level text
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(_stress_level,'') IN ('high','3','4','5') THEN 'cjVigY5qzO86Huf0OWal'
    WHEN COALESCE(_examiner_mode,'') = 'kritisch' THEN 'JBFqnCBsd6RMkjVDRZzb'
    WHEN COALESCE(_examiner_mode,'') = 'praxisorientiert' THEN 'TX3LPaxmHKxFdv7VOQHJ'
    WHEN COALESCE(_examiner_mode,'') = 'sachlich' THEN 'nPczCjzI2devNBz1zQrb'
    ELSE 'nPczCjzI2devNBz1zQrb'
  END
$$;

REVOKE ALL ON FUNCTION public.fn_oral_examiner_voice_id(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oral_examiner_voice_id(text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_oral_session_voice_context(_session_id uuid)
RETURNS TABLE(
  voice_id text,
  examiner_mode text,
  stress_level text,
  user_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.fn_oral_examiner_voice_id(t.examiner_mode, t.stress_level::text) AS voice_id,
    COALESCE(t.examiner_mode,'sachlich') AS examiner_mode,
    COALESCE(t.stress_level::text,'1') AS stress_level,
    s.user_id
  FROM public.oral_exam_sessions s
  LEFT JOIN public.oral_exam_session_templates t
    ON t.blueprint_id = s.blueprint_id
   AND t.curriculum_id = s.curriculum_id
  WHERE s.id = _session_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.fn_oral_session_voice_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oral_session_voice_context(uuid) TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module, schema_version)
VALUES
  ('oral_voice_tts_request',
    ARRAY['session_id','examiner_mode','stress_level','voice_id','text_length','caller_role']::text[],
    'examfit.oral.voice', 1),
  ('oral_voice_stt_request',
    ARRAY['session_id','audio_bytes','transcript_length','caller_role']::text[],
    'examfit.oral.voice', 1),
  ('oral_voice_quality_gate_fail',
    ARRAY['session_id','reason','caller_role']::text[],
    'examfit.oral.voice', 1)
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    owner_module = EXCLUDED.owner_module,
    updated_at = now();