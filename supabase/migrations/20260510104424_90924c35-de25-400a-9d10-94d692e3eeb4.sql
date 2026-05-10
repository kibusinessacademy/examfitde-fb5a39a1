CREATE OR REPLACE FUNCTION public.fn_simulate_dispatch_parity_notification(
  p_scenario text,
  p_outcome  text DEFAULT 'ok',
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
  v_attempts int := 0;
  v_status text := 'pending';
  v_error text;
  v_transitions jsonb := '[]'::jsonb;
BEGIN
  IF NOT v_should THEN
    RETURN jsonb_build_object(
      'scenario', p_scenario, 'outcome', p_outcome,
      'enqueued', false, 'reason', 'cron_guard_status_ok',
      'evaluation', v_eval
    );
  END IF;

  v_transitions := v_transitions || jsonb_build_object('attempt', 0, 'status', 'pending');

  LOOP
    v_attempts := v_attempts + 1;

    IF p_outcome = 'ok' THEN
      v_status := 'sent'; v_error := NULL;
    ELSIF p_outcome = 'missing_secret' THEN
      v_status := 'skipped'; v_error := 'missing_secret:SLACK_HEAL_WEBHOOK_URL';
    ELSIF p_outcome = 'webhook_500' THEN
      v_status := CASE WHEN v_attempts >= p_max_attempts THEN 'dlq' ELSE 'failed' END;
      v_error := 'webhook_5xx:simulated_500';
    ELSE
      v_status := 'failed'; v_error := 'unknown_outcome:' || p_outcome;
    END IF;

    v_transitions := v_transitions || jsonb_build_object(
      'attempt', v_attempts, 'status', v_status, 'error', v_error
    );

    EXIT WHEN v_status IN ('sent','skipped','dlq');
    EXIT WHEN v_attempts >= p_max_attempts;
  END LOOP;

  RETURN jsonb_build_object(
    'scenario', p_scenario, 'outcome', p_outcome,
    'enqueued', true, 'expected_severity', v_severity,
    'final_status', v_status, 'final_attempts', v_attempts,
    'reached_dlq', v_status = 'dlq', 'last_error', v_error,
    'transitions', v_transitions, 'evaluation', v_eval
  );
END;
$$;