
-- =========================================================================
-- Wave: SEO Health Cockpit Finalization (Phase 1+4+5)
-- Concern 1/1: Threshold-key add + alert_reasons + integrity filters + toggle telemetry
-- =========================================================================

-- ---- 1. Neuer Threshold-Key -----------------------------------------------
INSERT INTO public.ops_seo_alert_thresholds (threshold_key, threshold_value, severity, description)
VALUES ('oldest_pending_warn_min', 30, 'warn',
        'Pending-Alter (Min), ab dem ein WARN ausgelöst wird, sofern noch keine kritischen Bedingungen greifen')
ON CONFLICT (threshold_key) DO NOTHING;

-- ---- 2. admin_get_seo_job_health: + alert_reasons + oldest_pending threshold ----
DROP FUNCTION IF EXISTS public.admin_get_seo_job_health();

CREATE OR REPLACE FUNCTION public.admin_get_seo_job_health()
RETURNS TABLE(
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
  alert_severity text,
  alert_reasons text[]
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH thresholds AS (
    SELECT
      MAX(threshold_value) FILTER (WHERE threshold_key='empty_result_1h_critical')   AS t_empty_crit,
      MAX(threshold_value) FILTER (WHERE threshold_key='requeue_loop_1h_critical')   AS t_requeue_crit,
      MAX(threshold_value) FILTER (WHERE threshold_key='http_400_1h_warn')           AS t_http400_warn,
      MAX(threshold_value) FILTER (WHERE threshold_key='failure_rate_pct_1h_warn')   AS t_failrate_warn,
      MAX(threshold_value) FILTER (WHERE threshold_key='oldest_pending_warn_min')    AS t_oldest_warn
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
      COALESCE(MAX(age_min) FILTER (WHERE status='pending'), 0)::int AS oldest_pending_age_minutes
    FROM src
    GROUP BY job_type
  ),
  scored AS (
    SELECT
      a.*,
      CASE WHEN a.total_1h > 0
           THEN ROUND((a.failed_1h::numeric / a.total_1h::numeric) * 100, 1)
           ELSE NULL END AS failure_rate_pct_1h,
      t.t_empty_crit, t.t_requeue_crit, t.t_http400_warn, t.t_failrate_warn, t.t_oldest_warn
    FROM agg a CROSS JOIN thresholds t
  )
  SELECT
    s.job_type,
    s.pending_count,
    s.processing_count,
    s.failed_1h,
    s.failed_6h,
    s.cancelled_1h,
    s.empty_result_1h,
    s.http_400_1h,
    s.requeue_loop_1h,
    s.total_1h,
    s.failure_rate_pct_1h,
    s.oldest_pending_age_minutes,
    -- severity
    CASE
      WHEN s.empty_result_1h   >= COALESCE(s.t_empty_crit,   5) THEN 'critical'
      WHEN s.requeue_loop_1h   >= COALESCE(s.t_requeue_crit, 3) THEN 'critical'
      WHEN s.http_400_1h       >= COALESCE(s.t_http400_warn, 3) THEN 'warn'
      WHEN s.failure_rate_pct_1h IS NOT NULL
           AND s.failure_rate_pct_1h >= COALESCE(s.t_failrate_warn, 30) THEN 'warn'
      WHEN s.oldest_pending_age_minutes >= COALESCE(s.t_oldest_warn, 30) THEN 'warn'
      ELSE 'ok'
    END AS alert_severity,
    -- reasons (alle aktiven Trigger, nicht nur der höchste)
    ARRAY_REMOVE(ARRAY[
      CASE WHEN s.empty_result_1h >= COALESCE(s.t_empty_crit, 5)
           THEN 'EMPTY_RESULT_1h ' || s.empty_result_1h || ' >= ' || COALESCE(s.t_empty_crit, 5)::text
           END,
      CASE WHEN s.requeue_loop_1h >= COALESCE(s.t_requeue_crit, 3)
           THEN 'REQUEUE_LOOP_1h ' || s.requeue_loop_1h || ' >= ' || COALESCE(s.t_requeue_crit, 3)::text
           END,
      CASE WHEN s.http_400_1h >= COALESCE(s.t_http400_warn, 3)
           THEN 'HTTP_400_1h ' || s.http_400_1h || ' >= ' || COALESCE(s.t_http400_warn, 3)::text
           END,
      CASE WHEN s.failure_rate_pct_1h IS NOT NULL
                AND s.failure_rate_pct_1h >= COALESCE(s.t_failrate_warn, 30)
           THEN 'FAILURE_RATE_1h ' || s.failure_rate_pct_1h::text || '% >= ' || COALESCE(s.t_failrate_warn, 30)::text || '%'
           END,
      CASE WHEN s.oldest_pending_age_minutes >= COALESCE(s.t_oldest_warn, 30)
           THEN 'OLDEST_PENDING ' || s.oldest_pending_age_minutes || 'min >= ' || COALESCE(s.t_oldest_warn, 30)::text || 'min'
           END
    ], NULL) AS alert_reasons
  FROM scored s
  ORDER BY s.job_type;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_seo_job_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_job_health() TO authenticated;

-- ---- 3. admin_get_recent_integrity_gate_failures: + filter params ----
DROP FUNCTION IF EXISTS public.admin_get_recent_integrity_gate_failures(integer, integer);

CREATE OR REPLACE FUNCTION public.admin_get_recent_integrity_gate_failures(
  p_limit            integer DEFAULT 10,
  p_window_minutes   integer DEFAULT 60,
  p_min_score        numeric DEFAULT NULL,
  p_max_score        numeric DEFAULT NULL,
  p_package_id       uuid    DEFAULT NULL,
  p_hard_fail_only   boolean DEFAULT false,
  p_error_code       text    DEFAULT NULL
)
RETURNS TABLE(
  job_id uuid,
  package_id uuid,
  status text,
  last_error_code text,
  last_error text,
  integrity_passed boolean,
  score numeric,
  hard_fail_count integer,
  created_at timestamp with time zone,
  age_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    jq.id,
    (jq.payload->>'package_id')::uuid,
    jq.status::text,
    jq.last_error_code::text,
    jq.last_error::text,
    NULLIF(jq.meta->'last_result'->>'integrity_passed','')::boolean,
    NULLIF(jq.meta->'last_result'->>'score','')::numeric,
    NULLIF(jq.meta->'last_result'->>'hard_fail_count','')::int,
    jq.created_at,
    EXTRACT(EPOCH FROM (now() - jq.created_at))::int
  FROM public.job_queue jq
  WHERE jq.job_type = 'package_run_integrity_check'
    AND jq.created_at > now() - make_interval(mins => GREATEST(1, p_window_minutes))
    AND (
      jq.last_error = 'QUALITY_THRESHOLD_NOT_MET'
      OR jq.last_error_code = 'QUALITY_THRESHOLD_NOT_MET'
      OR (jq.meta->'last_result'->>'integrity_passed') = 'false'
    )
    AND (p_package_id IS NULL OR (jq.payload->>'package_id')::uuid = p_package_id)
    AND (p_min_score IS NULL OR NULLIF(jq.meta->'last_result'->>'score','')::numeric >= p_min_score)
    AND (p_max_score IS NULL OR NULLIF(jq.meta->'last_result'->>'score','')::numeric <= p_max_score)
    AND (NOT p_hard_fail_only OR COALESCE(NULLIF(jq.meta->'last_result'->>'hard_fail_count','')::int, 0) > 0)
    AND (p_error_code IS NULL
         OR jq.last_error_code = p_error_code
         OR jq.last_error      = p_error_code)
  ORDER BY jq.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_recent_integrity_gate_failures(integer, integer, numeric, numeric, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_recent_integrity_gate_failures(integer, integer, numeric, numeric, uuid, boolean, text) TO authenticated;

-- ---- 4. NEW: admin_get_seo_toggle_telemetry ----
CREATE OR REPLACE FUNCTION public.admin_get_seo_toggle_telemetry(
  p_flag_key text DEFAULT NULL
)
RETURNS TABLE(
  flag_key text,
  toggles_24h bigint,
  toggles_7d bigint,
  enable_count_7d bigint,
  disable_count_7d bigint,
  last_toggle_at timestamptz,
  last_toggle_actor uuid,
  last_toggle_direction text,
  rollback_frequency_score numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH gate AS (
    SELECT 1 WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ),
  src AS (
    SELECT
      ahl.target_id::text AS flag_key,
      ahl.created_at,
      (ahl.metadata->>'previous')::boolean AS prev_enabled,
      (ahl.metadata->>'new')::boolean      AS new_enabled,
      NULLIF(ahl.metadata->>'actor_uid','')::uuid AS actor_uid
    FROM public.auto_heal_log ahl
    WHERE ahl.action_type = 'seo_feature_flag_toggle'
      AND (p_flag_key IS NULL OR ahl.target_id = p_flag_key)
      AND EXISTS (SELECT 1 FROM gate)
  ),
  agg AS (
    SELECT
      flag_key,
      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS toggles_24h,
      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')   AS toggles_7d,
      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days' AND new_enabled IS TRUE)  AS enable_count_7d,
      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days' AND new_enabled IS FALSE) AS disable_count_7d,
      MAX(created_at) AS last_toggle_at
    FROM src
    GROUP BY flag_key
  ),
  last_row AS (
    SELECT DISTINCT ON (flag_key)
      flag_key, created_at, actor_uid,
      CASE WHEN new_enabled IS TRUE THEN 'enable'
           WHEN new_enabled IS FALSE THEN 'disable'
           ELSE 'unknown' END AS direction
    FROM src
    ORDER BY flag_key, created_at DESC
  )
  SELECT
    a.flag_key,
    a.toggles_24h,
    a.toggles_7d,
    a.enable_count_7d,
    a.disable_count_7d,
    a.last_toggle_at,
    l.actor_uid,
    l.direction,
    -- Score: höher = unruhig. >=4/24h = 1.0, sonst linear; +Bonus wenn 24h>=7d-Hälfte
    LEAST(
      1.0,
      (a.toggles_24h::numeric / 4.0)
      + CASE WHEN a.toggles_7d > 0 AND a.toggles_24h::numeric / NULLIF(a.toggles_7d,0) > 0.5
             THEN 0.2 ELSE 0 END
    )::numeric AS rollback_frequency_score
  FROM agg a
  LEFT JOIN last_row l USING (flag_key)
  ORDER BY a.flag_key;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_seo_toggle_telemetry(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_toggle_telemetry(text) TO authenticated;

-- ---- 5. Audit (one-shot wave marker) ----
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'seo_health_cockpit_wave',
  'system',
  'wave_finalization_v1',
  'ok',
  jsonb_build_object(
    'wave', 'seo_health_cockpit_finalization',
    'phases_db', ARRAY['threshold_oldest_pending','alert_reasons','integrity_filters','toggle_telemetry'],
    'rollback_hint', 'DROP FUNCTION admin_get_seo_toggle_telemetry; revert admin_get_recent_integrity_gate_failures to (int,int) signature; recreate admin_get_seo_job_health without alert_reasons; DELETE FROM ops_seo_alert_thresholds WHERE threshold_key=''oldest_pending_warn_min''',
    'created_at', now()
  )
);
