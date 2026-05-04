-- ============================================================
-- 1) Detection View: stale validate_exam_pool
-- ============================================================
DROP VIEW IF EXISTS public.v_stale_validation_detection CASCADE;

CREATE VIEW public.v_stale_validation_detection AS
WITH latest_approval AS (
  SELECT curriculum_id,
         MAX(reviewed_at) AS last_approved_at,
         COUNT(*) AS approved_total
  FROM public.exam_questions
  WHERE qc_status = 'approved' AND reviewed_at IS NOT NULL
  GROUP BY curriculum_id
),
active_jobs AS (
  SELECT package_id, COUNT(*) AS active_job_count
  FROM public.job_queue
  WHERE status IN ('pending','queued','processing')
  GROUP BY package_id
)
SELECT
  ps.package_id,
  cp.title,
  cp.package_key,
  cp.status AS pkg_status,
  cp.curriculum_id,
  ps.finished_at AS validate_finished_at,
  la.last_approved_at,
  la.approved_total,
  ROUND((EXTRACT(epoch FROM (la.last_approved_at - ps.finished_at))/60)::numeric, 1) AS stale_minutes,
  COALESCE(aj.active_job_count, 0) AS active_job_count,
  COALESCE((cp.feature_flags->>'bronze_locked')::boolean, false) AS bronze_locked
FROM public.package_steps ps
JOIN public.course_packages cp ON cp.id = ps.package_id
JOIN latest_approval la ON la.curriculum_id = cp.curriculum_id
LEFT JOIN active_jobs aj ON aj.package_id = ps.package_id
WHERE ps.step_key = 'validate_exam_pool'
  AND ps.status = 'done'
  AND ps.finished_at IS NOT NULL
  AND la.last_approved_at > ps.finished_at + interval '2 minutes'
  AND cp.status IN ('queued','building');

REVOKE ALL ON public.v_stale_validation_detection FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_stale_validation_detection TO service_role;

COMMENT ON VIEW public.v_stale_validation_detection IS
  'Pakete (queued/building) mit validate_exam_pool=done, aber neuere approved exam_questions danach. Nur über admin_heal_stale_validation aufrufbar.';

-- ============================================================
-- 2) Heal RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_heal_stale_validation(
  p_package_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT false,
  p_max_packages int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  r record;
  v_processed int := 0;
  v_skipped int := 0;
  v_steps_reset int;
  v_validate_job_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_skip_reason text;
BEGIN
  -- Admin-Gate
  SELECT public.has_role(v_caller, 'admin') INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'admin_heal_stale_validation: admin role required';
  END IF;

  FOR r IN
    SELECT * FROM public.v_stale_validation_detection
    WHERE (p_package_id IS NULL OR package_id = p_package_id)
    ORDER BY stale_minutes DESC
    LIMIT p_max_packages
  LOOP
    -- Eligibility
    v_skip_reason := NULL;
    IF r.active_job_count > 0 THEN
      v_skip_reason := format('active_jobs=%s', r.active_job_count);
    ELSIF r.bronze_locked THEN
      v_skip_reason := 'bronze_locked';
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id,
        'title', r.title,
        'action', 'skipped',
        'reason', v_skip_reason,
        'stale_minutes', r.stale_minutes
      );
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id,
        'title', r.title,
        'action', 'dry_run',
        'would_reset_steps', jsonb_build_array('validate_exam_pool','run_integrity_check','quality_council','auto_publish'),
        'stale_minutes', r.stale_minutes,
        'last_approved_at', r.last_approved_at,
        'validate_finished_at', r.validate_finished_at
      );
      v_processed := v_processed + 1;
      CONTINUE;
    END IF;

    -- Reset Tail (validate + downstream) — NICHT generate_exam_pool
    UPDATE public.package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        updated_at = now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'stale_validation_heal',
          'reset_by', 'admin_heal_stale_validation',
          'reset_at', now()::text,
          'reset_reason', 'stale_validation_detected',
          'stale_minutes', r.stale_minutes,
          'last_approved_at', r.last_approved_at::text
        )
    WHERE package_id = r.package_id
      AND step_key IN ('validate_exam_pool','run_integrity_check','quality_council','auto_publish')
      AND status IN ('done','failed','blocked','skipped');

    GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

    -- Enqueue fresh validate_exam_pool
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta)
    VALUES (
      'package_validate_exam_pool', r.package_id, 'pending', 20, 3,
      jsonb_build_object(
        'package_id', r.package_id,
        'curriculum_id', r.curriculum_id,
        'step_key', 'validate_exam_pool',
        'enqueue_source', 'stale_validation_heal',
        'triggered_by', 'admin_heal_stale_validation'
      ),
      jsonb_build_object(
        'origin', 'stale_validation_heal',
        'enqueued_by', 'admin_heal_stale_validation',
        'stale_minutes', r.stale_minutes
      )
    )
    RETURNING id INTO v_validate_job_id;

    -- Audit
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'stale_validation_reset',
      'course_package', r.package_id::text, 'success',
      format('reset %s tail steps + enqueued validate_exam_pool (stale %s min)', v_steps_reset, r.stale_minutes),
      jsonb_build_object(
        'package_id', r.package_id,
        'package_key', r.package_key,
        'title', r.title,
        'pkg_status', r.pkg_status,
        'tail_steps_reset', v_steps_reset,
        'validate_job_id', v_validate_job_id,
        'stale_minutes', r.stale_minutes,
        'last_approved_at', r.last_approved_at,
        'previous_validate_finished_at', r.validate_finished_at
      )
    );

    v_processed := v_processed + 1;
    v_results := v_results || jsonb_build_object(
      'package_id', r.package_id,
      'title', r.title,
      'action', 'reset',
      'tail_steps_reset', v_steps_reset,
      'validate_job_id', v_validate_job_id,
      'stale_minutes', r.stale_minutes
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'processed', v_processed,
    'skipped', v_skipped,
    'results', v_results,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_stale_validation(uuid, boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_stale_validation(uuid, boolean, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_heal_stale_validation IS
  'Heilt validate_exam_pool=done mit neueren approved exam_questions: setzt validate→auto_publish auf queued + enqueued package_validate_exam_pool. NICHT generate_exam_pool. Skip bei active_jobs oder bronze_locked. Audit stale_validation_reset.';

-- ============================================================
-- 3) Summary RPC für Cockpit
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_stale_validation_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_summary jsonb;
BEGIN
  SELECT public.has_role(v_caller, 'admin') INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'admin_get_stale_validation_summary: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'by_status', jsonb_object_agg(pkg_status, n),
    'eligible_now', SUM(CASE WHEN active_job_count = 0 AND NOT bronze_locked THEN n ELSE 0 END),
    'blocked_active_jobs', SUM(CASE WHEN active_job_count > 0 THEN n ELSE 0 END),
    'blocked_bronze', SUM(CASE WHEN bronze_locked THEN n ELSE 0 END),
    'max_stale_minutes', MAX(max_stale),
    'avg_stale_minutes', ROUND(AVG(avg_stale)::numeric, 1)
  )
  INTO v_summary
  FROM (
    SELECT pkg_status,
           COUNT(*) AS n,
           BOOL_OR(active_job_count > 0) AS has_active,
           BOOL_OR(bronze_locked) AS has_bronze,
           SUM(active_job_count) AS active_job_count,
           BOOL_OR(bronze_locked) AS bronze_locked,
           MAX(stale_minutes) AS max_stale,
           AVG(stale_minutes) AS avg_stale
    FROM public.v_stale_validation_detection
    GROUP BY pkg_status
  ) s;

  RETURN COALESCE(v_summary, jsonb_build_object('total', 0));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_stale_validation_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stale_validation_summary() TO authenticated, service_role;