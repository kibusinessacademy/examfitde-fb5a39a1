-- Dispatcher dry-run simulator for parity-cron-guard outbox.
-- Exercises the real heal_alert_notifications row lifecycle (pending → sent|skipped|failed|dlq)
-- WITHOUT invoking Slack/Resend. The synthetic row is tagged via payload.simulated=true
-- and removed at the end so production dashboards stay clean.
CREATE OR REPLACE FUNCTION public.fn_simulate_dispatch_parity_notification(
  p_scenario text,                 -- 'fresh' | 'late' | 'missing'
  p_outcome  text DEFAULT 'ok',    -- 'ok' | 'missing_secret' | 'webhook_500'
  p_max_attempts int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval jsonb := public.fn_simulate_parity_cron_guard_outbox(p_scenario);
  v_should boolean := (v_eval->>'would_enqueue_notification')::boolean;
  v_severity text := v_eval->>'expected_severity';
  v_id uuid;
  v_attempts int := 0;
  v_final_status text;
  v_final_error text;
  v_transitions jsonb := '[]'::jsonb;
BEGIN
  IF NOT v_should THEN
    RETURN jsonb_build_object(
      'scenario', p_scenario,
      'outcome', p_outcome,
      'enqueued', false,
      'reason', 'cron_guard_status_ok',
      'evaluation', v_eval
    );
  END IF;

  INSERT INTO heal_alert_notifications
    (channel, target, alert_key, severity, payload, status, attempts)
  VALUES
    ('simulated', 'dryrun://parity-cron-guard', 'parity_cron_health', v_severity,
     jsonb_build_object(
       'simulated', true,
       'scenario', p_scenario,
       'outcome', p_outcome,
       'evaluation', v_eval
     ),
     'pending', 0)
  RETURNING id INTO v_id;

  v_transitions := v_transitions || jsonb_build_object('attempt', 0, 'status', 'pending');

  -- Simulated dispatcher loop
  LOOP
    v_attempts := v_attempts + 1;

    IF p_outcome = 'ok' THEN
      v_final_status := 'sent';
      v_final_error := NULL;
    ELSIF p_outcome = 'missing_secret' THEN
      v_final_status := 'skipped';
      v_final_error := 'missing_secret:SLACK_HEAL_WEBHOOK_URL';
    ELSIF p_outcome = 'webhook_500' THEN
      v_final_status := CASE WHEN v_attempts >= p_max_attempts THEN 'dlq' ELSE 'failed' END;
      v_final_error := 'webhook_5xx:simulated_500';
    ELSE
      v_final_status := 'failed';
      v_final_error := 'unknown_outcome:' || p_outcome;
    END IF;

    UPDATE heal_alert_notifications
       SET status = v_final_status,
           attempts = v_attempts,
           last_error = v_final_error,
           sent_at = CASE WHEN v_final_status='sent' THEN now() ELSE sent_at END
     WHERE id = v_id;

    v_transitions := v_transitions || jsonb_build_object(
      'attempt', v_attempts, 'status', v_final_status, 'error', v_final_error
    );

    -- Terminal states stop the loop; transient 'failed' retries
    EXIT WHEN v_final_status IN ('sent','skipped','dlq');
    EXIT WHEN v_attempts >= p_max_attempts;
  END LOOP;

  -- Capture final row snapshot before cleanup
  PERFORM 1; -- noop placeholder

  -- Clean up the synthetic row (dispatcher dry-run never persists)
  DELETE FROM heal_alert_notifications WHERE id = v_id;

  RETURN jsonb_build_object(
    'scenario', p_scenario,
    'outcome', p_outcome,
    'enqueued', true,
    'final_status', v_final_status,
    'final_attempts', v_attempts,
    'reached_dlq', v_final_status = 'dlq',
    'last_error', v_final_error,
    'transitions', v_transitions,
    'evaluation', v_eval
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_simulate_dispatch_parity_notification(text,text,int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulate_dispatch_parity_notification(text,text,int)
  TO anon, authenticated, service_role;