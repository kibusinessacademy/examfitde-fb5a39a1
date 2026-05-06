CREATE OR REPLACE FUNCTION public.admin_mark_sender_verified_and_smoke(
  p_verified boolean DEFAULT true,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_outbox_id uuid;
  v_alert_key text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT value INTO v_old
  FROM public.admin_settings
  WHERE key = 'launch_alert_from_address';

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'launch_alert_from_address setting not configured';
  END IF;

  v_new := v_old
    || jsonb_build_object(
         'verified', COALESCE(p_verified, true),
         'updated_at', to_jsonb(now())
       );

  UPDATE public.admin_settings
  SET value = v_new, updated_at = now()
  WHERE key = 'launch_alert_from_address';

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'launch_alert_from_address_verified_set',
    'admin_settings',
    NULL,
    'success',
    jsonb_build_object(
      'actor', v_uid,
      'verified', COALESCE(p_verified, true),
      'previous', v_old,
      'new', v_new,
      'note', p_note
    )
  );

  -- Enqueue smoke alert (unique alert_key per minute to bypass dedupe)
  v_alert_key := 'launch_alert_sender_smoke_' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.launch_alert_email_outbox(
    alert_key, severity, summary, details, dedupe_window_start
  )
  VALUES (
    v_alert_key,
    'info',
    'Smoke-Test: Launch-Alert Sender',
    jsonb_build_object(
      'reason', 'manual_smoke_after_verified_toggle',
      'verified', COALESCE(p_verified, true),
      'from', v_new,
      'triggered_by', v_uid,
      'note', p_note,
      'triggered_at', now()
    ),
    date_trunc('minute', now())
  )
  RETURNING id INTO v_outbox_id;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'launch_alert_sender_smoke_enqueued',
    'launch_alert_email_outbox',
    v_outbox_id::text,
    'success',
    jsonb_build_object('actor', v_uid, 'alert_key', v_alert_key)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'verified', COALESCE(p_verified, true),
    'outbox_id', v_outbox_id,
    'alert_key', v_alert_key,
    'flush_hint', 'flush worker runs every 5 minutes; you can also invoke launch-alert-email-flush directly'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_sender_verified_and_smoke(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_sender_verified_and_smoke(boolean, text) TO authenticated;