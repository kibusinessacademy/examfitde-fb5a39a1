CREATE OR REPLACE FUNCTION public.verwaltung_finalize_realtime_session(_convai_session_id text, _transcript jsonb, _scores jsonb, _debrief jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid; v_user_id uuid; v_already_finalized boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF _convai_session_id IS NULL OR length(_convai_session_id) = 0 THEN RAISE EXCEPTION 'missing_convai_session_id'; END IF;

  SELECT id, user_id,
         (scores IS NOT NULL AND scores <> '{}'::jsonb AND debrief IS NOT NULL AND debrief <> '{}'::jsonb)
    INTO v_session_id, v_user_id, v_already_finalized
  FROM public.verwaltung_oral_sessions
  WHERE realtime_convai_session_id = _convai_session_id
  ORDER BY realtime_started_at DESC NULLS LAST LIMIT 1;

  IF v_session_id IS NULL THEN
    PERFORM public.fn_emit_audit(_action_type:='verwaltung_realtime_webhook_received',
      _payload:=jsonb_build_object('convai_session_id',_convai_session_id,'session_id',NULL,'outcome','session_not_found','caller_role','service_role'));
    RETURN jsonb_build_object('ok',false,'reason','session_not_found');
  END IF;

  IF v_already_finalized THEN
    PERFORM public.fn_emit_audit(_action_type:='verwaltung_realtime_webhook_received',
      _payload:=jsonb_build_object('convai_session_id',_convai_session_id,'session_id',v_session_id,'outcome','idempotent_skip','caller_role','service_role'));
    RETURN jsonb_build_object('ok',true,'idempotent',true,'session_id',v_session_id);
  END IF;

  UPDATE public.verwaltung_oral_sessions
     SET realtime_transcript = COALESCE(_transcript, realtime_transcript),
         scores              = COALESCE(_scores,  scores),
         debrief             = COALESCE(_debrief, debrief),
         ended_at            = COALESCE(ended_at, now()),
         realtime_ended_at   = COALESCE(realtime_ended_at, now()),
         status              = 'finished',
         realtime_mode       = false
   WHERE id = v_session_id;

  PERFORM public.fn_emit_audit(_action_type:='verwaltung_realtime_debrief_generated',
    _payload:=jsonb_build_object('convai_session_id',_convai_session_id,'session_id',v_session_id,'user_id',v_user_id,
      'overall_score',COALESCE((_scores->>'overall')::int,0),'caller_role','service_role'));

  RETURN jsonb_build_object('ok',true,'session_id',v_session_id);
END; $function$;