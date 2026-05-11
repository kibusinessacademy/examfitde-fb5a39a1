-- F5: SEO Job Health Alert Calibration v1
-- - Add threshold `min_sample_1h_for_rate` (default 5)
-- - failure_rate_pct_1h guarded: NULL bei total_1h < min_sample (verhindert 100%-Spike bei 1/1 fail)
-- - seo_sitemap_refresh aus Filter entfernt (Phase-2 decommissioned)
-- - Reasons ergänzt um Sample-Hinweis bei NULL-Rate

INSERT INTO public.ops_seo_alert_thresholds (threshold_key, threshold_value, description, severity)
VALUES ('min_sample_1h_for_rate', 5, 'Mindestanzahl Jobs in der letzten Stunde, bevor failure_rate_pct_1h überhaupt für Alerting herangezogen wird', 'warn')
ON CONFLICT (threshold_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_get_seo_job_health()
 RETURNS TABLE(job_type text, pending_count bigint, processing_count bigint, failed_1h bigint, failed_6h bigint, cancelled_1h bigint, empty_result_1h bigint, http_400_1h bigint, requeue_loop_1h bigint, total_1h bigint, failure_rate_pct_1h numeric, oldest_pending_age_minutes integer, alert_severity text, alert_reasons text[])
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
      MAX(threshold_value) FILTER (WHERE threshold_key='oldest_pending_warn_min')    AS t_oldest_warn,
      MAX(threshold_value) FILTER (WHERE threshold_key='min_sample_1h_for_rate')     AS t_min_sample
    FROM public.ops_seo_alert_thresholds
  ),
  src AS (
    SELECT jq.job_type, jq.status, jq.last_error, jq.created_at, jq.updated_at,
           EXTRACT(EPOCH FROM (now() - jq.created_at))/60 AS age_min
    FROM public.job_queue jq
    WHERE jq.job_type IN ('seo_internal_links')
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
      -- F5: failure_rate_pct_1h ist NUR aussagekräftig ab min_sample. Sonst NULL → kein Alert.
      CASE
        WHEN a.total_1h >= COALESCE(t.t_min_sample, 5)
          THEN ROUND((a.failed_1h::numeric / NULLIF(a.total_1h,0)::numeric) * 100, 1)
        ELSE NULL
      END AS failure_rate_pct_1h,
      t.t_empty_crit, t.t_requeue_crit, t.t_http400_warn, t.t_failrate_warn, t.t_oldest_warn, t.t_min_sample
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
    CASE
      WHEN s.empty_result_1h   >= COALESCE(s.t_empty_crit,   5) THEN 'critical'
      WHEN s.requeue_loop_1h   >= COALESCE(s.t_requeue_crit, 3) THEN 'critical'
      WHEN s.http_400_1h       >= COALESCE(s.t_http400_warn, 3) THEN 'warn'
      WHEN s.failure_rate_pct_1h IS NOT NULL
           AND s.failure_rate_pct_1h >= COALESCE(s.t_failrate_warn, 30) THEN 'warn'
      WHEN s.oldest_pending_age_minutes >= COALESCE(s.t_oldest_warn, 30) THEN 'warn'
      ELSE 'ok'
    END AS alert_severity,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN s.empty_result_1h >= COALESCE(s.t_empty_crit, 5)
           THEN 'EMPTY_RESULT_1h ' || s.empty_result_1h || ' >= ' || COALESCE(s.t_empty_crit, 5)::text END,
      CASE WHEN s.requeue_loop_1h >= COALESCE(s.t_requeue_crit, 3)
           THEN 'REQUEUE_LOOP_1h ' || s.requeue_loop_1h || ' >= ' || COALESCE(s.t_requeue_crit, 3)::text END,
      CASE WHEN s.http_400_1h >= COALESCE(s.t_http400_warn, 3)
           THEN 'HTTP_400_1h ' || s.http_400_1h || ' >= ' || COALESCE(s.t_http400_warn, 3)::text END,
      CASE WHEN s.failure_rate_pct_1h IS NOT NULL
                AND s.failure_rate_pct_1h >= COALESCE(s.t_failrate_warn, 30)
           THEN 'FAILURE_RATE_1h ' || s.failure_rate_pct_1h::text || '% >= ' || COALESCE(s.t_failrate_warn, 30)::text || '% (sample=' || s.total_1h || ')' END,
      CASE WHEN s.failure_rate_pct_1h IS NULL AND s.failed_1h > 0
           THEN 'LOW_SAMPLE total_1h=' || s.total_1h || ' < ' || COALESCE(s.t_min_sample, 5)::text || ' (rate suppressed)' END,
      CASE WHEN s.oldest_pending_age_minutes >= COALESCE(s.t_oldest_warn, 30)
           THEN 'OLDEST_PENDING ' || s.oldest_pending_age_minutes || 'min >= ' || COALESCE(s.t_oldest_warn, 30)::text || 'min' END
    ], NULL) AS alert_reasons
  FROM scored s
  ORDER BY s.job_type;
$function$;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'seo_alert_calibration_v1',
  'system',
  'ok',
  jsonb_build_object(
    'phase', 'F5',
    'changes', jsonb_build_array(
      'added threshold min_sample_1h_for_rate=5',
      'failure_rate_pct_1h NULL when total_1h < min_sample',
      'removed seo_sitemap_refresh from health filter (decommissioned in Phase 2)',
      'added LOW_SAMPLE reason hint'
    ),
    'rollback_hint', 'restore admin_get_seo_job_health from migration 20260511 (pre-F5) and DELETE threshold min_sample_1h_for_rate'
  )
);

-- Smoke
DO $$
DECLARE
  v_min_sample int;
  v_warn_count int;
BEGIN
  SELECT threshold_value INTO v_min_sample FROM public.ops_seo_alert_thresholds WHERE threshold_key='min_sample_1h_for_rate';
  IF v_min_sample IS NULL OR v_min_sample <> 5 THEN
    RAISE EXCEPTION 'F5 smoke: min_sample threshold not seeded';
  END IF;
  SELECT COUNT(*) INTO v_warn_count FROM public.admin_get_seo_job_health()
    WHERE alert_severity='warn' AND failure_rate_pct_1h IS NULL;
  IF v_warn_count > 0 THEN
    RAISE EXCEPTION 'F5 smoke: warn fired despite NULL failure_rate (low-sample guard broken)';
  END IF;
END $$;