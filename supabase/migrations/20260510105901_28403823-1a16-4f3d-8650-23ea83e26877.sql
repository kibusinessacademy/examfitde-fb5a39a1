
CREATE OR REPLACE FUNCTION public.admin_e2e_outbox_enqueue(
  p_scenario text DEFAULT 'late',
  p_outcome  text DEFAULT 'ok',
  p_max_attempts int DEFAULT 5,
  p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dest uuid; v_id uuid; v_sev text; v_existing uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Idempotency: reuse non-terminal row if same key already in flight
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
    SELECT id INTO v_existing
      FROM public.heal_alert_notifications
     WHERE alert_key = '__e2e_parity'
       AND payload->>'idempotency_key' = p_idempotency_key
       AND status IN ('pending','processing','failed')
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  v_dest := public.fn_e2e_outbox_seed_destination();
  v_sev := CASE p_scenario WHEN 'missing' THEN 'high' WHEN 'late' THEN 'medium' ELSE 'info' END;

  INSERT INTO public.heal_alert_notifications(
    destination_id, channel, target, alert_key, severity,
    payload, status, attempts, max_attempts, next_attempt_at
  ) VALUES (
    v_dest, 'slack', '__e2e_test__', '__e2e_parity', v_sev,
    jsonb_build_object('__e2e', true, 'scenario', p_scenario, 'outcome', p_outcome)
      || CASE WHEN p_idempotency_key IS NOT NULL AND p_idempotency_key <> ''
              THEN jsonb_build_object('idempotency_key', p_idempotency_key)
              ELSE '{}'::jsonb END,
    'pending', 0, GREATEST(1,p_max_attempts), now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
