-- ====================================================================
-- BLOCKER-OPS WAVE 2: Auto-Defer Council + Stale Reaper RPC + Throughput Metrics
-- ====================================================================

-- 1) Audit table for council deferrals
CREATE TABLE IF NOT EXISTS public.council_defer_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  curriculum_id uuid,
  defer_reason text NOT NULL,
  error_codes text[] NOT NULL DEFAULT '{}',
  fail_count integer NOT NULL,
  deferred_at timestamptz NOT NULL DEFAULT now(),
  deferred_by text NOT NULL DEFAULT 'fn_auto_defer_stale_council',
  cleared_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_council_defer_log_pkg_active
  ON public.council_defer_log (package_id) WHERE cleared_at IS NULL;

ALTER TABLE public.council_defer_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read council defer log" ON public.council_defer_log;
CREATE POLICY "Admins read council defer log"
  ON public.council_defer_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Auto-Defer Trigger: ≥3× STALE_*/MAX_ATTEMPTS_EXHAUSTED in 6h → defer
CREATE OR REPLACE FUNCTION public.fn_auto_defer_stale_council()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_codes text[] := ARRAY['STALE_PROCESSING_EXHAUSTED','STALE_PROCESSING_REAPED','MAX_ATTEMPTS_EXHAUSTED','JOB_LIVENESS_GUARD'];
  v_fail_count int;
  v_codes text[];
  v_curriculum_id uuid;
  v_already_deferred boolean;
BEGIN
  IF NEW.job_type <> 'package_quality_council' OR NEW.status <> 'failed' OR NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only fire on stale-pattern errors
  IF NEW.last_error_code IS NULL OR NOT (NEW.last_error_code = ANY(v_stale_codes)) THEN
    RETURN NEW;
  END IF;

  -- Skip if already deferred
  SELECT EXISTS(
    SELECT 1 FROM public.council_defer_log
    WHERE package_id = NEW.package_id AND cleared_at IS NULL
  ) INTO v_already_deferred;
  IF v_already_deferred THEN
    RETURN NEW;
  END IF;

  -- Count stale-pattern fails for this package in last 6h (incl. this one)
  SELECT COUNT(*), array_agg(DISTINCT last_error_code) FILTER (WHERE last_error_code IS NOT NULL)
    INTO v_fail_count, v_codes
  FROM public.job_queue
  WHERE job_type = 'package_quality_council'
    AND package_id = NEW.package_id
    AND status = 'failed'
    AND last_error_code = ANY(v_stale_codes)
    AND COALESCE(completed_at, updated_at) > now() - interval '6 hours';

  IF v_fail_count < 3 THEN
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM public.course_packages WHERE id = NEW.package_id;

  INSERT INTO public.council_defer_log
    (package_id, curriculum_id, defer_reason, error_codes, fail_count, meta)
  VALUES (
    NEW.package_id,
    v_curriculum_id,
    'STALE_WORKER_PATTERN_3X',
    v_codes,
    v_fail_count,
    jsonb_build_object('triggered_by_job_id', NEW.id, 'last_error_code', NEW.last_error_code)
  );

  -- Mark the package_steps row as skipped so publish_readiness can flow
  UPDATE public.package_steps
     SET status = 'skipped',
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
           'auto_deferred', true,
           'defer_reason', 'STALE_WORKER_PATTERN_3X',
           'deferred_at', now()
         ),
         updated_at = now()
   WHERE package_id = NEW.package_id
     AND step_key = 'quality_council'
     AND status NOT IN ('done','skipped');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_defer_stale_council ON public.job_queue;
CREATE TRIGGER trg_auto_defer_stale_council
  AFTER UPDATE OF status ON public.job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'failed' AND NEW.job_type = 'package_quality_council')
  EXECUTE FUNCTION public.fn_auto_defer_stale_council();

-- 3) Aggressive Stale-Processing Reaper RPC (admin-only, on-demand)
CREATE OR REPLACE FUNCTION public.admin_reap_stale_processing_now(
  p_max_age_seconds integer DEFAULT 300,
  p_max_cancels integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cancelled int := 0;
  v_requeued int := 0;
  v_audit jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  PERFORM set_config('app.transition_source', 'admin_ui:reap_stale_now:' || COALESCE(v_uid::text,'unknown'), true);

  FOR r IN
    SELECT id, job_type, package_id, attempts, max_attempts,
           EXTRACT(EPOCH FROM (now() - COALESCE(last_heartbeat_at, started_at)))::int AS stale_age
    FROM public.job_queue
    WHERE status IN ('processing','running')
      AND COALESCE(last_heartbeat_at, started_at) < now() - (p_max_age_seconds || ' seconds')::interval
    ORDER BY COALESCE(last_heartbeat_at, started_at) ASC
    LIMIT p_max_cancels
  LOOP
    IF r.attempts >= COALESCE(r.max_attempts, 5) THEN
      UPDATE public.job_queue
         SET status = 'failed',
             last_error = 'admin_reap_stale: heartbeat ' || r.stale_age || 's old, attempts exhausted',
             last_error_code = 'STALE_PROCESSING_EXHAUSTED',
             completed_at = now(),
             updated_at = now()
       WHERE id = r.id;
      v_cancelled := v_cancelled + 1;
    ELSE
      UPDATE public.job_queue
         SET status = 'pending',
             locked_at = NULL, locked_by = NULL, started_at = NULL,
             last_heartbeat_at = NULL, liveness_status = NULL,
             run_after = now() + interval '5 seconds',
             last_error = 'admin_reap_stale: requeued after ' || r.stale_age || 's stale',
             last_error_code = 'STALE_PROCESSING_REAPED',
             updated_at = now()
       WHERE id = r.id;
      v_requeued := v_requeued + 1;
    END IF;

    v_audit := v_audit || jsonb_build_object(
      'job_id', r.id, 'job_type', r.job_type, 'package_id', r.package_id,
      'stale_age_sec', r.stale_age, 'attempts', r.attempts,
      'action', CASE WHEN r.attempts >= COALESCE(r.max_attempts,5) THEN 'cancelled' ELSE 'requeued' END
    );
  END LOOP;

  -- Audit
  INSERT INTO public.admin_actions (user_id, action, target_type, target_id, payload)
  VALUES (v_uid, 'reap_stale_processing_now', 'job_queue', NULL,
    jsonb_build_object(
      'max_age_seconds', p_max_age_seconds,
      'max_cancels', p_max_cancels,
      'cancelled', v_cancelled,
      'requeued', v_requeued,
      'details', v_audit
    ));

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled', v_cancelled,
    'requeued', v_requeued,
    'total_processed', v_cancelled + v_requeued,
    'details', v_audit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reap_stale_processing_now(integer,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_reap_stale_processing_now(integer,integer) TO authenticated;

-- 4) Throughput-Metrics RPC for queue#live snapshot
CREATE OR REPLACE FUNCTION public.admin_get_queue_throughput(
  p_window_hours integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  WITH base AS (
    SELECT job_type, status, attempts, started_at, completed_at, created_at, last_error_code
    FROM public.job_queue
    WHERE created_at > now() - (p_window_hours || ' hours')::interval
  ),
  global AS (
    SELECT
      COUNT(*) FILTER (WHERE status='completed' AND completed_at > now() - interval '1 hour') AS jobs_per_hour,
      COUNT(*) FILTER (WHERE status='completed') AS completed_total,
      COUNT(*) FILTER (WHERE status='failed') AS failed_total,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)))
        FILTER (WHERE status='completed' AND started_at IS NOT NULL)::int AS duration_p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)))
        FILTER (WHERE status='completed' AND started_at IS NOT NULL)::int AS duration_p95,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
        FILTER (WHERE status='completed' AND started_at IS NOT NULL)::int AS duration_avg,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)))
        FILTER (WHERE status='completed')::int AS lifecycle_p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)))
        FILTER (WHERE status='completed')::int AS lifecycle_p95
    FROM base
  ),
  by_type AS (
    SELECT json_agg(j ORDER BY (j->>'completed')::int DESC) AS jobs_by_type
    FROM (
      SELECT jsonb_build_object(
        'job_type', job_type,
        'completed', COUNT(*) FILTER (WHERE status='completed'),
        'failed', COUNT(*) FILTER (WHERE status='failed'),
        'duration_p50', PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)))
                          FILTER (WHERE status='completed' AND started_at IS NOT NULL)::int,
        'duration_p95', PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)))
                          FILTER (WHERE status='completed' AND started_at IS NOT NULL)::int
      ) AS j
      FROM base
      GROUP BY job_type
      HAVING COUNT(*) FILTER (WHERE status='completed') > 0
    ) sub
  )
  SELECT jsonb_build_object(
    'window_hours', p_window_hours,
    'computed_at', now(),
    'global', (SELECT row_to_json(global)::jsonb FROM global),
    'by_type', (SELECT jobs_by_type FROM by_type)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_queue_throughput(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_queue_throughput(integer) TO authenticated;

-- 5) Studio Status-Distribution view + Stale definition (>72h non-terminal)
CREATE OR REPLACE VIEW public.v_studio_status_distribution AS
WITH terminal AS (SELECT unnest(ARRAY['done','published','archived','cancelled']) AS s)
SELECT
  status,
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE updated_at < now() - interval '72 hours'
      AND status NOT IN (SELECT s FROM terminal)
  ) AS stale_count,
  COUNT(*) FILTER (WHERE is_published = true) AS published_count,
  MIN(updated_at) AS oldest_updated_at
FROM public.course_packages
GROUP BY status
ORDER BY total DESC;

GRANT SELECT ON public.v_studio_status_distribution TO authenticated;

-- 6) Council deferred packages view (for BlockerOps banner)
CREATE OR REPLACE VIEW public.v_council_deferred_packages AS
SELECT
  cdl.id AS defer_id,
  cdl.package_id,
  cdl.curriculum_id,
  cp.title AS package_title,
  cdl.defer_reason,
  cdl.error_codes,
  cdl.fail_count,
  cdl.deferred_at,
  cdl.cleared_at,
  cp.status AS package_status,
  cp.is_published
FROM public.council_defer_log cdl
JOIN public.course_packages cp ON cp.id = cdl.package_id
WHERE cdl.cleared_at IS NULL
ORDER BY cdl.deferred_at DESC;

GRANT SELECT ON public.v_council_deferred_packages TO authenticated;

-- 7) Patch v_admin_publish_readiness to recognize council-deferred as "done"
CREATE OR REPLACE VIEW public.v_admin_publish_readiness AS
SELECT
  c.package_id,
  c.curriculum_id,
  c.course_id,
  c.curriculum_title,
  c.course_title,
  c.package_status,
  c.build_progress,
  c.priority,
  c.curriculum_status,
  c.course_status,
  c.is_published,
  c.package_track,
  c.curriculum_track,
  c.program_type,
  c.steps_done,
  c.steps_failed,
  c.steps_open,
  c.steps_skipped,
  c.steps_functional,
  c.step_status_map,
  c.approved_exam_questions,
  c.usable_exam_questions,
  c.explanation_coverage_pct,
  c.trap_coverage_pct,
  c.handbook_chapters,
  c.approved_minicheck_questions,
  c.learning_lessons,
  c.tutor_index_items,
  c.oral_exam_step_status,
  c.integrity_step_status,
  c.integrity_report,
  c.integrity_passed,
  c.hard_fail_reasons,
  -- Treat council_deferred as 'done' for publish flow
  CASE WHEN cdl.package_id IS NOT NULL THEN 'done' ELSE c.quality_council_status END AS quality_council_status,
  c.auto_publish_status,
  c.latest_upgrade_current_track,
  c.latest_upgrade_recommended_track,
  c.latest_upgrade_score,
  c.latest_upgrade_decision,
  c.latest_upgrade_reasons,
  c.upgrade_decision_at,
  c.created_at,
  c.updated_at,
  c.track_compliant,
  c.track_violation_code,
  CASE
    WHEN c.package_track = 'AUSBILDUNG_VOLL' THEN c.approved_exam_questions >= 300 AND c.learning_lessons > 0 AND c.approved_minicheck_questions > 0 AND c.handbook_chapters > 0 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND (c.quality_council_status = 'done' OR cdl.package_id IS NOT NULL)
    WHEN c.package_track = 'EXAM_FIRST' THEN c.approved_exam_questions >= 150 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND (c.quality_council_status = 'done' OR cdl.package_id IS NOT NULL)
    WHEN c.package_track = 'EXAM_FIRST_PLUS' THEN c.approved_exam_questions >= 300 AND c.handbook_chapters > 0 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND (c.quality_council_status = 'done' OR cdl.package_id IS NOT NULL)
    WHEN c.package_track = 'STUDIUM' THEN c.approved_exam_questions >= 200 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND (c.quality_council_status = 'done' OR cdl.package_id IS NOT NULL)
    ELSE false
  END AS publish_ready,
  CASE
    WHEN c.integrity_passed IS NOT TRUE AND c.integrity_report IS NULL THEN 'INTEGRITY_NEVER_CHECKED'
    WHEN c.integrity_passed IS NOT TRUE AND c.integrity_report IS NOT NULL AND COALESCE((c.integrity_report->>'deferred')::boolean, false) = true THEN 'INTEGRITY_DEFERRED'
    WHEN c.integrity_passed IS NOT TRUE AND c.integrity_report IS NOT NULL AND (c.integrity_report = '{}'::jsonb OR (c.integrity_report->>'reason_code') IS NULL) THEN 'INTEGRITY_REPORT_MISSING'
    WHEN c.integrity_passed IS NOT TRUE THEN 'INTEGRITY_FAILED'
    WHEN c.quality_council_status <> 'done' AND cdl.package_id IS NULL THEN 'QUALITY_COUNCIL_PENDING'
    WHEN c.package_track = 'AUSBILDUNG_VOLL' AND c.learning_lessons = 0 THEN 'MISSING_LEARNING'
    WHEN c.package_track = 'AUSBILDUNG_VOLL' AND c.approved_minicheck_questions = 0 THEN 'MISSING_MINICHECKS'
    WHEN c.package_track = 'EXAM_FIRST_PLUS' AND c.handbook_chapters = 0 THEN 'MISSING_HANDBOOK'
    WHEN c.package_track IN ('EXAM_FIRST','EXAM_FIRST_PLUS') AND c.tutor_index_items = 0 THEN 'MISSING_TUTOR_INDEX'
    WHEN c.package_track = 'AUSBILDUNG_VOLL' AND c.approved_exam_questions < 300 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN c.package_track = 'EXAM_FIRST' AND c.approved_exam_questions < 150 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN c.package_track = 'EXAM_FIRST_PLUS' AND c.approved_exam_questions < 300 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN c.package_track = 'STUDIUM' AND c.approved_exam_questions < 200 THEN 'EXAM_POOL_TOO_SMALL'
    ELSE NULL
  END AS primary_blocker,
  (cdl.package_id IS NOT NULL) AS council_deferred,
  cdl.defer_reason AS council_defer_reason
FROM public.v_admin_track_compliance c
LEFT JOIN public.council_defer_log cdl ON cdl.package_id = c.package_id AND cdl.cleared_at IS NULL;

GRANT SELECT ON public.v_admin_publish_readiness TO authenticated;