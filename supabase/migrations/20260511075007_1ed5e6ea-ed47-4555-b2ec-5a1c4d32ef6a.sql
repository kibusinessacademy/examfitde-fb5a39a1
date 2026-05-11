-- ════════════════════════════════════════════════════════════════════
-- 1) Cron-Drift Detector
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_list_cron_drift_candidates()
RETURNS TABLE(jobid bigint, jobname text, schedule text, command text, is_drift boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.command,
    (j.command ~* 'current_setting\(\s*''app\.settings\.') AS is_drift
  FROM cron.job j
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
     OR auth.role() = 'service_role'
$$;

REVOKE ALL ON FUNCTION public.admin_list_cron_drift_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_cron_drift_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_cron_drift_candidates() TO authenticated;
-- (authenticated grant is filtered inside via has_role; non-admin returns empty set)

-- ════════════════════════════════════════════════════════════════════
-- 2) Rollback switch: sitemap_refresh producer enabled flag
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ops_feature_flags (
  flag_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.ops_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_feature_flags admin read" ON public.ops_feature_flags;
CREATE POLICY "ops_feature_flags admin read"
  ON public.ops_feature_flags FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "ops_feature_flags admin write" ON public.ops_feature_flags;
CREATE POLICY "ops_feature_flags admin write"
  ON public.ops_feature_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.ops_feature_flags (flag_key, enabled, notes)
VALUES (
  'seo_sitemap_refresh_producer_enabled',
  false,
  'Disabled 2026-05-11: no per-package handler exists. Flip to true once a handler ships. Read by fn_run_post_publish_growth_health_check / future producer.'
)
ON CONFLICT (flag_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_ops_feature_flag(p_key text, p_default boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT enabled FROM public.ops_feature_flags WHERE flag_key = p_key), p_default)
$$;
REVOKE ALL ON FUNCTION public.fn_ops_feature_flag(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ops_feature_flag(text, boolean) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 3) SEO job-health monitor
-- ════════════════════════════════════════════════════════════════════
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
  alert_severity text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT
      jq.job_type,
      jq.status,
      jq.last_error,
      jq.created_at,
      jq.updated_at,
      EXTRACT(EPOCH FROM (now() - jq.created_at))/60 AS age_min
    FROM public.job_queue jq
    WHERE jq.job_type IN ('seo_internal_links','seo_sitemap_refresh')
      AND (
        jq.status IN ('pending','processing')
        OR jq.updated_at > now() - interval '6 hours'
      )
  ),
  agg AS (
    SELECT
      job_type,
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
    FROM src
    GROUP BY job_type
  )
  SELECT
    a.job_type,
    a.pending_count,
    a.processing_count,
    a.failed_1h, a.failed_6h, a.cancelled_1h,
    a.empty_result_1h, a.http_400_1h, a.requeue_loop_1h,
    a.total_1h,
    CASE WHEN a.total_1h > 0
         THEN ROUND(100.0 * a.failed_1h / a.total_1h, 1)
         ELSE 0
    END AS failure_rate_pct_1h,
    COALESCE(a.oldest_pending_age_minutes::int, 0) AS oldest_pending_age_minutes,
    CASE
      WHEN a.empty_result_1h >= 5 OR a.requeue_loop_1h >= 3 THEN 'critical'
      WHEN a.total_1h > 0 AND (100.0 * a.failed_1h / a.total_1h) > 30 THEN 'warn'
      WHEN a.http_400_1h >= 3 THEN 'warn'
      ELSE 'ok'
    END AS alert_severity
  FROM agg a
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_job_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_job_health() TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 4) Cron alert: log to auto_heal_log when SEO health flips to warn/critical
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_seo_job_health_alert_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_alerts int := 0;
  v_details jsonb := '[]'::jsonb;
BEGIN
  FOR v_row IN SELECT * FROM public.admin_get_seo_job_health() WHERE alert_severity IN ('warn','critical')
  LOOP
    v_alerts := v_alerts + 1;
    v_details := v_details || to_jsonb(v_row);
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'seo_job_health_alert',
    'system',
    CASE WHEN v_alerts > 0 THEN 'alert' ELSE 'ok' END,
    jsonb_build_object(
      'alerts_emitted', v_alerts,
      'rows', v_details,
      'checked_at', now()
    )
  );

  RETURN jsonb_build_object('alerts', v_alerts);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_seo_job_health_alert_run() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_seo_job_health_alert_run() TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 5) Schedule cron (best-effort; skip if pg_cron missing)
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('seo-job-health-alert-15min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='seo-job-health-alert-15min');

    PERFORM cron.schedule(
      'seo-job-health-alert-15min',
      '*/15 * * * *',
      $cmd$ SELECT public.fn_seo_job_health_alert_run(); $cmd$
    );
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 6) Audit
-- ════════════════════════════════════════════════════════════════════
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'wave_cron_recovery_followup_hardening',
  'system', 'success',
  jsonb_build_object(
    'wave', 'cron_recovery_followup',
    'phase', 'verify_and_harden',
    'artifacts', jsonb_build_array(
      'admin_list_cron_drift_candidates',
      'ops_feature_flags + seo_sitemap_refresh_producer_enabled flag',
      'admin_get_seo_job_health',
      'fn_seo_job_health_alert_run + cron seo-job-health-alert-15min',
      'enqueue.ts coverage_repair allowed-statuses incl. queued',
      'src/test/ops/build-dispatch-payload.contract.test.ts',
      'scripts/guards/cron-app-settings-drift-guard.mjs'
    ),
    'next_step', 'observe PHK quarantine + sitemap drain; profile integrity_check separately.'
  )
);

-- Smoke
SELECT 'cron_drift_count' AS k, COUNT(*) FILTER (WHERE is_drift) AS v FROM public.admin_list_cron_drift_candidates();
SELECT 'seo_health_rows' AS k, COUNT(*) AS v FROM public.admin_get_seo_job_health();