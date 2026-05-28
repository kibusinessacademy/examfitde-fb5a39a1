ALTER TABLE public.verwaltung_oral_sessions
  ADD COLUMN IF NOT EXISTS realtime_transcript jsonb;

CREATE OR REPLACE FUNCTION public.verwaltung_finalize_realtime_session(
  _convai_session_id text,
  _transcript jsonb,
  _scores jsonb,
  _debrief jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_user_id uuid;
  v_already_finalized boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF _convai_session_id IS NULL OR length(_convai_session_id) = 0 THEN
    RAISE EXCEPTION 'missing_convai_session_id';
  END IF;

  SELECT id, user_id, (scores IS NOT NULL AND debrief IS NOT NULL)
    INTO v_session_id, v_user_id, v_already_finalized
  FROM public.verwaltung_oral_sessions
  WHERE realtime_convai_session_id = _convai_session_id
  ORDER BY realtime_started_at DESC NULLS LAST
  LIMIT 1;

  IF v_session_id IS NULL THEN
    PERFORM public.fn_emit_audit(
      'verwaltung_realtime_webhook_received',
      jsonb_build_object(
        'convai_session_id', _convai_session_id,
        'session_id',        NULL,
        'outcome',           'session_not_found',
        'caller_role',       'service_role'
      )
    );
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF v_already_finalized THEN
    PERFORM public.fn_emit_audit(
      'verwaltung_realtime_webhook_received',
      jsonb_build_object(
        'convai_session_id', _convai_session_id,
        'session_id',        v_session_id,
        'outcome',           'idempotent_skip',
        'caller_role',       'service_role'
      )
    );
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'session_id', v_session_id);
  END IF;

  UPDATE public.verwaltung_oral_sessions
     SET realtime_transcript = COALESCE(_transcript, realtime_transcript),
         scores              = _scores,
         debrief             = _debrief,
         finalized_at        = COALESCE(finalized_at, now()),
         realtime_ended_at   = COALESCE(realtime_ended_at, now()),
         realtime_mode       = false
   WHERE id = v_session_id;

  PERFORM public.fn_emit_audit(
    'verwaltung_realtime_debrief_generated',
    jsonb_build_object(
      'convai_session_id', _convai_session_id,
      'session_id',        v_session_id,
      'user_id',           v_user_id,
      'overall_score',     COALESCE(_scores->>'overall','0')::int,
      'caller_role',       'service_role'
    )
  );

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_finalize_realtime_session(text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verwaltung_finalize_realtime_session(text, jsonb, jsonb, jsonb) TO service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('verwaltung_realtime_webhook_received',
   ARRAY['convai_session_id','session_id','outcome','caller_role'],
   'verwaltungsos.realtime'),
  ('verwaltung_realtime_debrief_generated',
   ARRAY['convai_session_id','session_id','user_id','overall_score','caller_role'],
   'verwaltungsos.realtime')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module,
      updated_at    = now();