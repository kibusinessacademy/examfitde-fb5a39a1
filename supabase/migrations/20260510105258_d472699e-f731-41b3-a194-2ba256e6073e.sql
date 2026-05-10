
CREATE OR REPLACE FUNCTION public.fn_e2e_outbox_seed_destination()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.heal_alert_destinations
   WHERE channel='slack' AND target='__e2e_test__' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.heal_alert_destinations(channel, target, enabled, alert_keys, min_severity)
  VALUES ('slack','__e2e_test__', false, ARRAY['__e2e_parity']::text[], 'info')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Channel column on notifications must also align (was 'cockpit' which has no constraint, fine)
-- Fix enqueue: use 'slack' to be consistent with the destination row.
CREATE OR REPLACE FUNCTION public.admin_e2e_outbox_enqueue(
  p_scenario text DEFAULT 'late',
  p_outcome  text DEFAULT 'ok',
  p_max_attempts int DEFAULT 5
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dest uuid; v_id uuid; v_sev text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_dest := public.fn_e2e_outbox_seed_destination();
  v_sev := CASE p_scenario WHEN 'missing' THEN 'high' WHEN 'late' THEN 'medium' ELSE 'info' END;

  INSERT INTO public.heal_alert_notifications(
    destination_id, channel, target, alert_key, severity,
    payload, status, attempts, max_attempts, next_attempt_at
  ) VALUES (
    v_dest, 'slack', '__e2e_test__', '__e2e_parity', v_sev,
    jsonb_build_object('__e2e', true, 'scenario', p_scenario, 'outcome', p_outcome),
    'pending', 0, GREATEST(1,p_max_attempts), now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
