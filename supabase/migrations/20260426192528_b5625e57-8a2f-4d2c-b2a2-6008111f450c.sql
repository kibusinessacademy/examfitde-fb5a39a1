-- =============================================
-- P1: Differenzierter primary_blocker
-- =============================================
CREATE OR REPLACE VIEW public.v_admin_publish_readiness AS
SELECT
  package_id,
  curriculum_id,
  course_id,
  curriculum_title,
  course_title,
  package_status,
  build_progress,
  priority,
  curriculum_status,
  course_status,
  is_published,
  package_track,
  curriculum_track,
  program_type,
  steps_done,
  steps_failed,
  steps_open,
  steps_skipped,
  steps_functional,
  step_status_map,
  approved_exam_questions,
  usable_exam_questions,
  explanation_coverage_pct,
  trap_coverage_pct,
  handbook_chapters,
  approved_minicheck_questions,
  learning_lessons,
  tutor_index_items,
  oral_exam_step_status,
  integrity_step_status,
  integrity_report,
  integrity_passed,
  hard_fail_reasons,
  quality_council_status,
  auto_publish_status,
  latest_upgrade_current_track,
  latest_upgrade_recommended_track,
  latest_upgrade_score,
  latest_upgrade_decision,
  latest_upgrade_reasons,
  upgrade_decision_at,
  created_at,
  updated_at,
  track_compliant,
  track_violation_code,
  CASE
    WHEN package_track = 'AUSBILDUNG_VOLL' THEN approved_exam_questions >= 300 AND learning_lessons > 0 AND approved_minicheck_questions > 0 AND handbook_chapters > 0 AND tutor_index_items > 0 AND integrity_passed = true AND quality_council_status = 'done'
    WHEN package_track = 'EXAM_FIRST' THEN approved_exam_questions >= 150 AND tutor_index_items > 0 AND integrity_passed = true AND quality_council_status = 'done'
    WHEN package_track = 'EXAM_FIRST_PLUS' THEN approved_exam_questions >= 300 AND handbook_chapters > 0 AND tutor_index_items > 0 AND integrity_passed = true AND quality_council_status = 'done'
    WHEN package_track = 'STUDIUM' THEN approved_exam_questions >= 200 AND tutor_index_items > 0 AND integrity_passed = true AND quality_council_status = 'done'
    ELSE false
  END AS publish_ready,
  CASE
    -- Differentiated integrity blockers
    WHEN integrity_passed IS NOT TRUE AND integrity_report IS NULL THEN 'INTEGRITY_NEVER_CHECKED'
    WHEN integrity_passed IS NOT TRUE
         AND integrity_report IS NOT NULL
         AND COALESCE((integrity_report->>'deferred')::boolean, false) = true
         THEN 'INTEGRITY_DEFERRED'
    WHEN integrity_passed IS NOT TRUE
         AND integrity_report IS NOT NULL
         AND (integrity_report = '{}'::jsonb
              OR (integrity_report->>'reason_code') IS NULL)
         THEN 'INTEGRITY_REPORT_MISSING'
    WHEN integrity_passed IS NOT TRUE THEN 'INTEGRITY_FAILED'
    -- Original downstream blockers
    WHEN quality_council_status <> 'done' THEN 'QUALITY_COUNCIL_PENDING'
    WHEN package_track = 'AUSBILDUNG_VOLL' AND learning_lessons = 0 THEN 'MISSING_LEARNING'
    WHEN package_track = 'AUSBILDUNG_VOLL' AND approved_minicheck_questions = 0 THEN 'MISSING_MINICHECKS'
    WHEN package_track = 'EXAM_FIRST_PLUS' AND handbook_chapters = 0 THEN 'MISSING_HANDBOOK'
    WHEN package_track IN ('EXAM_FIRST','EXAM_FIRST_PLUS') AND tutor_index_items = 0 THEN 'MISSING_TUTOR_INDEX'
    WHEN package_track = 'AUSBILDUNG_VOLL' AND approved_exam_questions < 300 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN package_track = 'EXAM_FIRST' AND approved_exam_questions < 150 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN package_track = 'EXAM_FIRST_PLUS' AND approved_exam_questions < 300 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN package_track = 'STUDIUM' AND approved_exam_questions < 200 THEN 'EXAM_POOL_TOO_SMALL'
    ELSE NULL
  END AS primary_blocker
FROM v_admin_track_compliance c;

-- =============================================
-- P2: Blocker-Cluster-View für Cockpit
-- =============================================
CREATE OR REPLACE VIEW public.v_admin_publish_blocker_clusters AS
SELECT
  COALESCE(v.primary_blocker, 'OK') AS primary_blocker,
  COALESCE(v.package_track, 'unknown') AS package_track,
  COALESCE(v.track_violation_code, 'none') AS track_violation_code,
  COUNT(*) AS package_count,
  COUNT(*) FILTER (WHERE v.integrity_report IS NULL) AS empty_integrity_reports,
  COUNT(*) FILTER (WHERE v.integrity_passed IS FALSE) AS integrity_failed_count,
  COUNT(*) FILTER (WHERE COALESCE((v.integrity_report->>'deferred')::boolean, false)) AS integrity_deferred_count,
  MIN(v.updated_at) AS oldest_updated_at,
  MAX(v.updated_at) AS newest_updated_at,
  ARRAY_AGG(DISTINCT v.course_title ORDER BY v.course_title)
    FILTER (WHERE v.course_title IS NOT NULL) AS sample_courses
FROM v_admin_publish_readiness v
WHERE v.package_status IN ('building','publish_ready','published')
GROUP BY 1,2,3
ORDER BY package_count DESC;

GRANT SELECT ON public.v_admin_publish_blocker_clusters TO authenticated, service_role;

-- =============================================
-- P4: Aggressiver Stale-Job-Reaper
-- =============================================
CREATE OR REPLACE FUNCTION public.fn_reap_stale_jobs_aggressive()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlocked    integer := 0;
  v_cancelled   integer := 0;
  v_terminal    integer := 0;
BEGIN
  -- Step 1: Hard cancel jobs with stale_recoveries >= 5
  WITH hard_cancel AS (
    UPDATE public.job_queue jq
    SET status = 'cancelled',
        completed_at = now(),
        updated_at = now(),
        last_error_code = 'STALE_REAPER_TERMINAL',
        last_error = 'Cancelled after >=5 liveness recoveries (stale_reaper_aggressive)',
        meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
          'stale_reaper_terminal_at', to_jsonb(now()),
          'stale_reaper_reason', 'liveness_recoveries_exhausted'
        )
    WHERE jq.status IN ('processing','running','pending')
      AND COALESCE((jq.meta->>'liveness_requeued')::boolean, false) = true
      AND COALESCE((jq.meta->>'transient_attempts')::int, 0) >= 5
    RETURNING jq.id, jq.package_id, jq.job_type
  )
  SELECT count(*) INTO v_cancelled FROM hard_cancel;

  -- Step 2: Unlock jobs with started_at NULL but locked_at set (orphans)
  UPDATE public.job_queue
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'stale_reaper_unlocked_at', to_jsonb(now()),
        'stale_reaper_reason', 'orphan_lock_no_start'
      )
  WHERE status = 'processing'
    AND started_at IS NULL
    AND locked_at < now() - interval '15 minutes'
    AND COALESCE((meta->>'transient_attempts')::int, 0) < 5;
  GET DIAGNOSTICS v_unlocked = ROW_COUNT;

  -- Step 3: Mark jobs without progress as terminal block (attempts >= max_attempts)
  UPDATE public.job_queue
  SET status = 'cancelled',
      completed_at = now(),
      updated_at = now(),
      last_error_code = 'MAX_ATTEMPTS_TERMINAL',
      last_error = COALESCE(last_error, 'Cancelled: max_attempts exhausted'),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'stale_reaper_terminal_at', to_jsonb(now()),
        'stale_reaper_reason', 'max_attempts_exhausted'
      )
  WHERE status IN ('processing','pending','running')
    AND attempts >= max_attempts
    AND updated_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_terminal = ROW_COUNT;

  -- Log to auto_heal_log if it exists
  BEGIN
    INSERT INTO public.auto_heal_log (action, payload, created_at)
    VALUES (
      'stale_reaper_aggressive_run',
      jsonb_build_object(
        'unlocked', v_unlocked,
        'hard_cancelled', v_cancelled,
        'terminal_blocked', v_terminal,
        'ts', now()
      ),
      now()
    );
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'unlocked', v_unlocked,
    'hard_cancelled', v_cancelled,
    'terminal_blocked', v_terminal,
    'ts', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reap_stale_jobs_aggressive() TO authenticated, service_role;

-- Schedule every 10 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stale-reaper-aggressive') THEN
    PERFORM cron.unschedule('stale-reaper-aggressive');
  END IF;
  PERFORM cron.schedule(
    'stale-reaper-aggressive',
    '*/10 * * * *',
    $cron$ SELECT public.fn_reap_stale_jobs_aggressive(); $cron$
  );
END $$;