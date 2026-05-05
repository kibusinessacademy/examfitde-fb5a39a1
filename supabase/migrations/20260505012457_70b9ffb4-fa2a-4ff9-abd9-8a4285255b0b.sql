CREATE OR REPLACE FUNCTION public.enqueue_integrity_rechecks(p_cap integer DEFAULT 150, p_reason text DEFAULT 'manual'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap int := GREATEST(10, LEAST(COALESCE(p_cap,150), 500));
  v_inserted int := 0;
  v_candidates int := 0;
  v_skipped_bronze int := 0;
  v_skipped_tail_done int := 0;
  v_current_version int;
  v_src text := COALESCE(NULLIF(p_reason,''),'integrity_recheck_cron');
BEGIN
  v_current_version := current_integrity_report_version_num();

  WITH base AS (
    SELECT cp.id, cp.curriculum_id, cp.feature_flags, cp.integrity_report,
      COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean,false)
        OR COALESCE(cp.feature_flags->'bronze'->>'final_state','') IN ('requires_review','manual_approved')
        AS is_bronze_locked,
      (SELECT COUNT(*) FROM public.package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish',
                              'validate_tutor_index','validate_oral_exam','validate_exam_pool',
                              'validate_lesson_minichecks','generate_oral_exam',
                              'build_ai_tutor_index','elite_harden','repair_exam_pool_quality')
          AND ps.status NOT IN ('done','skipped')) AS open_tail_steps,
      COALESCE((cp.integrity_report->>'integrity_score')::numeric,
               (cp.integrity_report->>'score')::numeric, 0) AS last_score
    FROM public.course_packages cp
    WHERE cp.status IN ('building', 'done', 'published', 'draft')
      AND (
        cp.integrity_report IS NULL
        OR COALESCE(cp.integrity_report_version_num, 0) < v_current_version
        OR (cp.status = 'quality_gate_failed' AND cp.track = 'EXAM_FIRST')
      )
  ),
  cls AS (
    SELECT *,
      CASE
        WHEN is_bronze_locked THEN 'skip_bronze_locked'
        WHEN last_score >= 85 AND open_tail_steps = 0 THEN 'skip_tail_done_high_score'
        ELSE 'eligible'
      END AS verdict
    FROM base
  ),
  candidates AS (
    SELECT id, curriculum_id FROM cls
    WHERE verdict = 'eligible'
    ORDER BY id LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT
      'package_run_integrity_check', 'pending',
      jsonb_build_object(
        'package_id', c.id::text,
        'curriculum_id', c.curriculum_id::text,
        'reason', p_reason,
        'enqueue_source', v_src),
      c.id, 'core', 70, 3
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending','queued','processing','running')
        AND jq.package_id = c.id
    )
    RETURNING 1
  )
  SELECT
    (SELECT COUNT(*) FROM candidates),
    (SELECT COUNT(*) FROM ins),
    (SELECT COUNT(*) FROM cls WHERE verdict='skip_bronze_locked'),
    (SELECT COUNT(*) FROM cls WHERE verdict='skip_tail_done_high_score')
  INTO v_candidates, v_inserted, v_skipped_bronze, v_skipped_tail_done;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('integrity_recheck_cron_run', v_src, 'system', 'batch', 'ok',
    format('eligible=%s enqueued=%s skip_bronze=%s skip_tail_done=%s', v_candidates, v_inserted, v_skipped_bronze, v_skipped_tail_done),
    jsonb_build_object('cap',v_cap,'enqueue_source',v_src,'current_version',v_current_version,
      'skip_bronze_locked',v_skipped_bronze,'skip_tail_done_high_score',v_skipped_tail_done));

  RETURN jsonb_build_object(
    'cap', v_cap,
    'eligible', v_candidates,
    'enqueued', v_inserted,
    'skipped_bronze_locked', v_skipped_bronze,
    'skipped_tail_done_high_score', v_skipped_tail_done,
    'current_version', v_current_version,
    'enqueue_source', v_src
  );
END;
$function$;