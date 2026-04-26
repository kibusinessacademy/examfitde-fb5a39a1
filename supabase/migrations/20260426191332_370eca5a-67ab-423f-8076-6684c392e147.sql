-- ============================================================
-- 1) admin_ops_queue_overview: Cockpit Queue-Übersicht-RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_ops_queue_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_status_counts jsonb;
  v_type_counts jsonb;
  v_oldest_pending timestamptz;
  v_stale_processing int;
  v_done_last_hour int;
  v_failed_last_hour int;
BEGIN
  -- Counts by status (last 24h window for noise reduction, plus all-time for active)
  SELECT jsonb_object_agg(status, cnt)
  INTO v_status_counts
  FROM (
    SELECT status, COUNT(*) as cnt
    FROM public.job_queue
    WHERE status IN ('pending','processing','failed')
       OR (status IN ('completed','cancelled','failed') AND COALESCE(completed_at, updated_at) > now() - interval '24 hours')
    GROUP BY status
  ) s;

  -- Counts by job_type (active only)
  SELECT jsonb_object_agg(job_type, cnt)
  INTO v_type_counts
  FROM (
    SELECT job_type, COUNT(*) as cnt
    FROM public.job_queue
    WHERE status IN ('pending','processing')
    GROUP BY job_type
    ORDER BY cnt DESC
    LIMIT 25
  ) t;

  -- Oldest pending
  SELECT MIN(created_at) INTO v_oldest_pending
  FROM public.job_queue WHERE status = 'pending';

  -- Stale processing (no heartbeat in 10 min)
  SELECT COUNT(*) INTO v_stale_processing
  FROM public.job_queue
  WHERE status = 'processing'
    AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '10 minutes');

  -- Throughput last hour
  SELECT COUNT(*) INTO v_done_last_hour
  FROM public.job_queue
  WHERE status = 'completed' AND completed_at > now() - interval '1 hour';

  SELECT COUNT(*) INTO v_failed_last_hour
  FROM public.job_queue
  WHERE status = 'failed' AND COALESCE(completed_at, updated_at) > now() - interval '1 hour';

  v_result := jsonb_build_object(
    'generated_at', now(),
    'status_counts', COALESCE(v_status_counts, '{}'::jsonb),
    'top_active_types', COALESCE(v_type_counts, '{}'::jsonb),
    'oldest_pending_at', v_oldest_pending,
    'oldest_pending_age_seconds', EXTRACT(EPOCH FROM (now() - v_oldest_pending))::int,
    'stale_processing_count', v_stale_processing,
    'throughput_last_hour', jsonb_build_object(
      'completed', v_done_last_hour,
      'failed', v_failed_last_hour
    )
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_ops_queue_overview() TO authenticated;

-- ============================================================
-- 2) admin_get_integrity_failure_summary: Aggregierte Diagnose
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_integrity_failure_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_failed int;
  v_no_report int;
  v_with_report int;
  v_current_version int;
  v_stale_version int;
  v_top_reasons jsonb;
BEGIN
  v_current_version := public.current_integrity_report_version_num();

  SELECT COUNT(*) INTO v_total_failed
  FROM public.course_packages
  WHERE integrity_passed = false;

  SELECT COUNT(*) INTO v_no_report
  FROM public.course_packages
  WHERE integrity_passed = false AND integrity_report IS NULL;

  SELECT COUNT(*) INTO v_with_report
  FROM public.course_packages
  WHERE integrity_passed = false AND integrity_report IS NOT NULL;

  SELECT COUNT(*) INTO v_stale_version
  FROM public.course_packages
  WHERE integrity_passed = false
    AND integrity_report IS NOT NULL
    AND COALESCE(integrity_report_version_num, 0) < v_current_version;

  -- Aggregate top hard-fail reasons across all reports
  SELECT jsonb_object_agg(reason, cnt)
  INTO v_top_reasons
  FROM (
    SELECT reason, COUNT(*) as cnt
    FROM public.course_packages cp,
         LATERAL jsonb_array_elements_text(
           COALESCE(cp.integrity_report->'hard_fails', cp.integrity_report->'hard_fail_reasons', '[]'::jsonb)
         ) as reason
    WHERE cp.integrity_passed = false
      AND cp.integrity_report IS NOT NULL
    GROUP BY reason
    ORDER BY cnt DESC
    LIMIT 20
  ) r;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'current_report_version', v_current_version,
    'total_failed', v_total_failed,
    'never_checked', v_no_report,
    'with_report', v_with_report,
    'stale_version', v_stale_version,
    'top_hard_fail_reasons', COALESCE(v_top_reasons, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_integrity_failure_summary() TO authenticated;

-- ============================================================
-- 3) View: v_admin_integrity_blocker_details (für UI)
-- ============================================================
DROP VIEW IF EXISTS public.v_admin_integrity_blocker_details CASCADE;

CREATE VIEW public.v_admin_integrity_blocker_details
WITH (security_invoker=on) AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.track,
  cp.integrity_passed,
  cp.integrity_profile,
  cp.integrity_report_version_num,
  CASE
    WHEN cp.integrity_report IS NULL THEN 'NEVER_CHECKED'
    WHEN cp.integrity_passed = true THEN 'OK'
    WHEN COALESCE(cp.integrity_report_version_num, 0) <
         public.current_integrity_report_version_num() THEN 'STALE_REPORT'
    ELSE 'INTEGRITY_FAILED'
  END AS blocker_state,
  COALESCE(
    cp.integrity_report->'hard_fails',
    cp.integrity_report->'hard_fail_reasons',
    '[]'::jsonb
  ) AS hard_fails,
  cp.integrity_report->>'score' AS integrity_score,
  cp.integrity_report->>'last_run_at' AS last_run_at,
  cp.integrity_report,
  cp.updated_at
FROM public.course_packages cp
WHERE cp.integrity_passed IS DISTINCT FROM true;

GRANT SELECT ON public.v_admin_integrity_blocker_details TO authenticated;

-- ============================================================
-- 4) Auto-Recheck Cron (15min) für Integrity-Backfill
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    -- Unschedule if exists
    PERFORM cron.unschedule(jobid)
    FROM cron.job WHERE jobname = 'auto-integrity-recheck-backfill';

    PERFORM cron.schedule(
      'auto-integrity-recheck-backfill',
      '*/15 * * * *',
      $cron$
      SELECT public.enqueue_integrity_rechecks(p_cap := 250, p_reason := 'auto_backfill_cron');
      $cron$
    );
  END IF;
END $$;

-- ============================================================
-- 5) Sofort-Backfill nach Migration
-- ============================================================
SELECT public.enqueue_integrity_rechecks(p_cap := 500, p_reason := 'cockpit_fix_initial_backfill');