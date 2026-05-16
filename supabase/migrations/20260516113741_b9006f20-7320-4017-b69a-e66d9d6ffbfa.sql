
CREATE OR REPLACE FUNCTION public.admin_get_notification_kpis(p_window_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(hours => GREATEST(1, p_window_hours));
  v_by_state jsonb;
  v_by_kind jsonb;
  v_by_suppression jsonb;
  v_subs_active integer;
  v_subs_revoked integer;
  v_delivered integer;
  v_attempted integer;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role)
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_object_agg(state, c) INTO v_by_state
  FROM (
    SELECT state, COUNT(*)::int AS c
    FROM notification_jobs
    WHERE created_at >= v_since
    GROUP BY state
  ) s;

  SELECT jsonb_object_agg(kind, c) INTO v_by_kind
  FROM (
    SELECT kind, COUNT(*)::int AS c
    FROM notification_jobs
    WHERE created_at >= v_since
    GROUP BY kind
  ) k;

  SELECT jsonb_object_agg(reason, c) INTO v_by_suppression
  FROM (
    SELECT COALESCE(suppression_reason, 'unknown') AS reason, COUNT(*)::int AS c
    FROM notification_jobs
    WHERE created_at >= v_since AND state = 'suppressed'
    GROUP BY suppression_reason
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) r;

  SELECT
    COUNT(*) FILTER (WHERE revoked_at IS NULL)::int,
    COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int
  INTO v_subs_active, v_subs_revoked
  FROM learner_push_subscriptions;

  SELECT
    COUNT(*) FILTER (WHERE state = 'delivered')::int,
    COUNT(*) FILTER (WHERE state IN ('delivered','failed'))::int
  INTO v_delivered, v_attempted
  FROM notification_jobs
  WHERE created_at >= v_since;

  RETURN jsonb_build_object(
    'window_hours', p_window_hours,
    'since', v_since,
    'by_state', COALESCE(v_by_state, '{}'::jsonb),
    'by_kind', COALESCE(v_by_kind, '{}'::jsonb),
    'top_suppression_reasons', COALESCE(v_by_suppression, '{}'::jsonb),
    'subscriptions_active', v_subs_active,
    'subscriptions_revoked', v_subs_revoked,
    'delivery_rate_pct',
      CASE WHEN v_attempted > 0
        THEN ROUND((v_delivered::numeric / v_attempted::numeric) * 100, 1)
        ELSE NULL END,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_notification_kpis(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_kpis(integer) TO authenticated, service_role;
