
CREATE TABLE IF NOT EXISTS public.ops_seo_alert_thresholds (
  threshold_key text PRIMARY KEY,
  threshold_value numeric NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warn','critical')),
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.ops_seo_alert_thresholds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ops_seo_alert_thresholds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ops_seo_alert_thresholds TO service_role;

INSERT INTO public.ops_seo_alert_thresholds (threshold_key, threshold_value, severity, description) VALUES
  ('empty_result_1h_critical',      5,  'critical', 'EMPTY_RESULT-Fails pro Stunde — ab diesem Wert CRIT'),
  ('requeue_loop_1h_critical',      3,  'critical', 'REQUEUE_LOOP-Vorfälle pro Stunde — ab diesem Wert CRIT'),
  ('http_400_1h_warn',              3,  'warn',     'HTTP 400 Errors pro Stunde — ab diesem Wert WARN'),
  ('failure_rate_pct_1h_warn',      30, 'warn',     'Fehlerrate (%) der letzten Stunde — ab diesem Wert WARN')
ON CONFLICT (threshold_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_get_seo_alert_thresholds()
RETURNS TABLE (
  threshold_key text,
  threshold_value numeric,
  severity text,
  description text,
  updated_at timestamptz,
  updated_by uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT t.threshold_key, t.threshold_value, t.severity, t.description, t.updated_at, t.updated_by
  FROM public.ops_seo_alert_thresholds t
  ORDER BY t.severity DESC, t.threshold_key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_alert_thresholds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_alert_thresholds() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_seo_alert_threshold(
  p_threshold_key text,
  p_threshold_value numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_previous numeric;
  v_severity text;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (min 5 chars)';
  END IF;

  IF p_threshold_value IS NULL OR p_threshold_value < 0 THEN
    RAISE EXCEPTION 'threshold_value must be >= 0';
  END IF;

  SELECT threshold_value, severity INTO v_previous, v_severity
  FROM public.ops_seo_alert_thresholds
  WHERE threshold_key = p_threshold_key;

  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'unknown threshold_key: %', p_threshold_key;
  END IF;

  UPDATE public.ops_seo_alert_thresholds
  SET threshold_value = p_threshold_value,
      updated_at = now(),
      updated_by = v_actor
  WHERE threshold_key = p_threshold_key;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'seo_alert_threshold_update',
    'config',
    p_threshold_key,
    'success',
    p_reason,
    jsonb_build_object(
      'threshold_key', p_threshold_key,
      'previous', v_previous,
      'new', p_threshold_value,
      'severity', v_severity,
      'reason', p_reason,
      'actor_uid', v_actor
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'threshold_key', p_threshold_key,
    'previous', v_previous,
    'new', p_threshold_value
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_seo_alert_threshold(text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_seo_alert_threshold(text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_seo_job_health()
RETURNS TABLE (
  job_type text,
  pending_count bigint,
  processing_count bigint,
  failed_1h bigint,
  failed_6h bigint,
  cancelled_1h bigint,
  empty_result_1h bigint,
  http_400_1h bigint,
  requeue_loop_1h bigint,
  total_1h bigint,
  failure_rate_pct_1h numeric,
  oldest_pending_age_minutes integer,
  alert_severity text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH thresholds AS (
    SELECT
      MAX(threshold_value) FILTER (WHERE threshold_key='empty_result_1h_critical')   AS t_empty_crit,
      MAX(threshold_value) FILTER (WHERE threshold_key='requeue_loop_1h_critical')   AS t_requeue_crit,
      MAX(threshold_value) FILTER (WHERE threshold_key='http_400_1h_warn')           AS t_http400_warn,
      MAX(threshold_value) FILTER (WHERE threshold_key='failure_rate_pct_1h_warn')   AS t_failrate_warn
    FROM public.ops_seo_alert_thresholds
  ),
  src AS (
    SELECT jq.job_type, jq.status, jq.last_error, jq.created_at, jq.updated_at,
           EXTRACT(EPOCH FROM (now() - jq.created_at))/60 AS age_min
    FROM public.job_queue jq
    WHERE jq.job_type IN ('seo_internal_links','seo_sitemap_refresh')
      AND (jq.status IN ('pending','processing') OR jq.updated_at > now() - interval '6 hours')
  ),
  agg AS (
    SELECT job_type,
      COUNT(*) FILTER (WHERE status='pending') AS pending_count,
      COUNT(*) FILTER (WHERE status='processing') AS processing_count,
      COUNT(*) FILTER (WHERE status='failed' AND updated_at > now() - interval '1 hour') AS failed_1h,
      COUNT(*) FILTER (WHERE status='failed' AND updated_at > now() - interval '6 hours') AS failed_6h,
      COUNT(*) FILTER (WHERE status='cancelled' AND updated_at > now() - interval '1 hour') AS cancelled_1h,
      COUNT(*) FILTER (WHERE last_error LIKE '%EMPTY_RESULT%' AND updated_at > now() - interval '1 hour') AS empty_result_1h,
      COUNT(*) FILTER (WHERE last_error LIKE '%HTTP 400%' AND updated_at > now() - interval '1 hour') AS http_400_1h,
      COUNT(*) FILTER (WHERE last_error LIKE '%REQUEUE_LOOP%' AND updated_at > now() - interval '1 hour') AS requeue_loop_1h,
      COUNT(*) FILTER (WHERE updated_at > now() - interval '1 hour') AS total_1h,
      MAX(age_min) FILTER (WHERE status='pending') AS oldest_pending_age_minutes
    FROM src GROUP BY job_type
  )
  SELECT
    a.job_type, a.pending_count, a.processing_count,
    a.failed_1h, a.failed_6h, a.cancelled_1h,
    a.empty_result_1h, a.http_400_1h, a.requeue_loop_1h, a.total_1h,
    CASE WHEN a.total_1h > 0 THEN ROUND(100.0 * a.failed_1h / a.total_1h, 1) ELSE 0 END AS failure_rate_pct_1h,
    COALESCE(a.oldest_pending_age_minutes::int, 0) AS oldest_pending_age_minutes,
    CASE
      WHEN a.empty_result_1h >= COALESCE(t.t_empty_crit, 5)
        OR a.requeue_loop_1h >= COALESCE(t.t_requeue_crit, 3)
        THEN 'critical'
      WHEN a.total_1h > 0
        AND (100.0 * a.failed_1h / a.total_1h) > COALESCE(t.t_failrate_warn, 30)
        THEN 'warn'
      WHEN a.http_400_1h >= COALESCE(t.t_http400_warn, 3) THEN 'warn'
      ELSE 'ok'
    END AS alert_severity
  FROM agg a CROSS JOIN thresholds t
$$;

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.ops_seo_alert_thresholds;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'smoke failed: expected 4 seed thresholds, got %', v_count;
  END IF;
END $$;

INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
VALUES (
  'seo_alert_thresholds_table_created',
  'system',
  'ops_seo_alert_thresholds',
  'success',
  'Threshold-Konfig-Table mit 4 Seeds + 2 RPCs + admin_get_seo_job_health auf dynamische Thresholds umgestellt',
  '{"seeds":4,"rpcs":["admin_get_seo_alert_thresholds","admin_set_seo_alert_threshold"]}'::jsonb
);
