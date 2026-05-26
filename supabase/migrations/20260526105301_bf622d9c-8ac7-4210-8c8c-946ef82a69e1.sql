-- Cut 6.1 Phase 3 — Audit-Contract-Alignment für HR-Demo
-- record_activation_signal mirror auf auto_heal_log via fn_emit_audit
-- für die 3 registrierten Contracts. Signal-Types werden auf Contract-Namen
-- gemappt (request → invoked) für Rückwärtskompatibilität.

CREATE OR REPLACE FUNCTION public.record_activation_signal(
  _persona text,
  _signal_type text,
  _anonymous_id text DEFAULT NULL,
  _session_id text DEFAULT NULL,
  _package_id uuid DEFAULT NULL,
  _painpoint_key text DEFAULT NULL,
  _source_page text DEFAULT NULL,
  _ip_hash text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_action_type text := NULL;
  v_payload jsonb;
BEGIN
  IF _persona IS NULL OR length(_persona) = 0 THEN
    RAISE EXCEPTION 'persona required' USING ERRCODE='22023';
  END IF;
  IF _signal_type IS NULL OR length(_signal_type) = 0 THEN
    RAISE EXCEPTION 'signal_type required' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.lead_activation_signals(
    anonymous_id, session_id, user_id, persona, signal_type,
    package_id, painpoint_key, source_page, ip_hash, metadata
  ) VALUES (
    _anonymous_id, _session_id, v_uid, _persona, _signal_type,
    _package_id, _painpoint_key, _source_page, _ip_hash, COALESCE(_metadata,'{}'::jsonb)
  )
  RETURNING id INTO v_id;

  -- Map signal_type → registered audit contract action_type
  v_action_type := CASE _signal_type
    WHEN 'demo_personalize_request'      THEN 'demo_personalize_invoked'
    WHEN 'demo_personalize_invoked'      THEN 'demo_personalize_invoked'
    WHEN 'demo_personalize_completed'    THEN 'demo_personalize_completed'
    WHEN 'demo_personalize_rate_limited' THEN 'demo_personalize_rate_limited'
    ELSE NULL
  END;

  IF v_action_type IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'persona', _persona,
      'signal_id', v_id
    )
    || COALESCE(_metadata, '{}'::jsonb)
    || CASE WHEN _package_id IS NOT NULL
            THEN jsonb_build_object('package_id', _package_id) ELSE '{}'::jsonb END
    || CASE WHEN _painpoint_key IS NOT NULL
            THEN jsonb_build_object('painpoint_key', _painpoint_key) ELSE '{}'::jsonb END
    || CASE WHEN _ip_hash IS NOT NULL
            THEN jsonb_build_object('ip_hash', _ip_hash) ELSE '{}'::jsonb END;

    BEGIN
      PERFORM public.fn_emit_audit(
        v_action_type,
        'lead_activation_signal',
        v_id::text,
        'success',
        v_payload,
        'edge_function',
        NULL
      );
    EXCEPTION WHEN OTHERS THEN
      -- never block signal write on audit emission
      NULL;
    END;
  END IF;

  RETURN v_id;
END;
$function$;