CREATE OR REPLACE FUNCTION public.admin_e2e_outbox_dispatch_step(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.heal_alert_notifications%ROWTYPE;
  v_outcome text;
  v_new_status text;
  v_new_error text;
  v_new_attempts int;
  v_backoff_minutes int;
  v_next_at timestamptz;
  v_prev_status text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_row FROM public.heal_alert_notifications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'row_not_found'; END IF;
  IF COALESCE(v_row.payload->>'__e2e','false') <> 'true' THEN
    RAISE EXCEPTION 'not_an_e2e_row';
  END IF;
  IF v_row.status IN ('sent','skipped','dlq') THEN
    RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'noop', true);
  END IF;

  -- Move to processing first (record transition)
  UPDATE public.heal_alert_notifications
     SET status='processing', dispatched_at=now()
   WHERE id = p_id;
  v_prev_status := 'processing';  -- semantic: previous_status is the in-step intermediate

  v_outcome := COALESCE(v_row.payload->>'outcome','ok');
  v_new_attempts := v_row.attempts + 1;

  IF v_outcome = 'ok' THEN
    v_new_status := 'sent'; v_new_error := NULL; v_next_at := NULL;
  ELSIF v_outcome = 'missing_secret' THEN
    v_new_status := 'skipped'; v_new_error := 'missing_secret:SLACK_HEAL_WEBHOOK_URL'; v_next_at := NULL;
  ELSIF v_outcome = 'webhook_500' THEN
    IF v_new_attempts >= v_row.max_attempts THEN
      v_new_status := 'dlq'; v_next_at := NULL;
    ELSE
      v_new_status := 'failed';
      v_backoff_minutes := POWER(2, v_new_attempts)::int;
      v_next_at := now() + make_interval(mins => v_backoff_minutes);
    END IF;
    v_new_error := 'webhook_5xx:simulated_500';
  ELSE
    v_new_status := 'failed'; v_new_error := 'unknown_outcome:' || v_outcome;
    v_next_at := now() + interval '2 minutes';
  END IF;

  UPDATE public.heal_alert_notifications
     SET status = v_new_status,
         attempts = v_new_attempts,
         last_error = v_new_error,
         next_attempt_at = v_next_at,
         sent_at = CASE WHEN v_new_status='sent' THEN now() ELSE sent_at END
   WHERE id = p_id;

  RETURN jsonb_build_object(
    'id', p_id, 'previous_status', v_prev_status, 'status', v_new_status,
    'attempts', v_new_attempts, 'max_attempts', v_row.max_attempts,
    'last_error', v_new_error, 'next_attempt_at', v_next_at,
    'reached_dlq', v_new_status='dlq', 'terminal', v_new_status IN ('sent','skipped','dlq')
  );
END $function$;