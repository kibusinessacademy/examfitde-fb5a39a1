-- Corrected Wave-Heal RPC for LF-Coverage gaps.
-- One concern: classify gap-packages and emit dedup-safe enqueue plan.
-- Default dry-run; admin-only; payload._origin canonical.

CREATE OR REPLACE FUNCTION public.admin_wave_heal_lf_coverage(
  _dry_run boolean DEFAULT true,
  _max_packages int DEFAULT 50,
  _target_per_lf int DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_run_id uuid := gen_random_uuid();
  v_enqueued jsonb := '[]'::jsonb;
  v_plan jsonb;
BEGIN
  -- Admin gate
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  WITH building_pkgs AS (
    SELECT cp.id AS package_id, cp.curriculum_id
    FROM course_packages cp
    WHERE cp.status IN ('building','queued','blocked')
      AND cp.curriculum_id IS NOT NULL
  ),
  lf_stats AS (
    SELECT
      bp.package_id,
      bp.curriculum_id,
      lf.id AS lf_id,
      lf.code AS lf_code,
      (SELECT COUNT(*) FROM question_blueprints qb
        WHERE qb.package_id = bp.package_id AND qb.learning_field_id = lf.id) AS bp_count,
      (SELECT COUNT(*) FROM exam_questions eq
        WHERE eq.package_id = bp.package_id AND eq.learning_field_id = lf.id
          AND eq.qc_status = 'approved') AS approved_count
    FROM building_pkgs bp
    JOIN learning_fields lf ON lf.curriculum_id = bp.curriculum_id
  ),
  stats AS (
    SELECT
      package_id,
      curriculum_id,
      COUNT(*)                                              AS lf_total,
      COUNT(*) FILTER (WHERE bp_count > 0)                  AS lfs_with_bp,
      COUNT(*) FILTER (WHERE bp_count = 0)                  AS lfs_missing_bp,
      COUNT(*) FILTER (WHERE approved_count < _target_per_lf) AS lfs_below_target,
      jsonb_agg(jsonb_build_object(
        'lf_id', lf_id, 'lf_code', lf_code,
        'bp_count', bp_count, 'approved', approved_count
      ) ORDER BY lf_code) AS lf_breakdown,
      array_agg(lf_code ORDER BY lf_code) FILTER (WHERE bp_count = 0) AS missing_bp_lfs
    FROM lf_stats
    GROUP BY package_id, curriculum_id
  ),
  classified AS (
    SELECT *,
      CASE
        WHEN lfs_with_bp = 0     THEN 'full_seed'
        WHEN lfs_missing_bp > 0  THEN 'targeted_seed'
        WHEN lfs_below_target > 0 THEN 'lf_repair_only'
        ELSE 'no_action'
      END AS action
    FROM stats
  ),
  already_active AS (
    SELECT DISTINCT package_id FROM job_queue
    WHERE status IN ('pending','queued','processing')
      AND job_type IN ('package_auto_seed_exam_blueprints',
                       'package_repair_exam_pool_lf_coverage',
                       'package_generate_exam_pool')
  ),
  already_enqueued_today AS (
    SELECT DISTINCT package_id FROM job_queue
    WHERE created_at > now() - interval '24 hours'
      AND payload->>'_origin' = 'wave_heal_lf_coverage'
  ),
  to_enqueue AS (
    SELECT c.* FROM classified c
    WHERE c.action <> 'no_action'
      AND c.package_id NOT IN (SELECT package_id FROM already_active)
      AND c.package_id NOT IN (SELECT package_id FROM already_enqueued_today)
    ORDER BY
      CASE c.action WHEN 'full_seed' THEN 0 WHEN 'targeted_seed' THEN 1 ELSE 2 END,
      c.lfs_missing_bp DESC
    LIMIT _max_packages
  )
  SELECT jsonb_agg(jsonb_build_object(
    'package_id',     package_id,
    'curriculum_id',  curriculum_id,
    'action',         action,
    'lf_total',       lf_total,
    'lfs_with_bp',    lfs_with_bp,
    'lfs_missing_bp', lfs_missing_bp,
    'lfs_below_target', lfs_below_target,
    'missing_bp_lfs', COALESCE(missing_bp_lfs, ARRAY[]::text[]),
    'lf_breakdown',   lf_breakdown
  ))
  INTO v_plan
  FROM to_enqueue;

  v_plan := COALESCE(v_plan, '[]'::jsonb);

  IF _dry_run THEN
    PERFORM public.fn_log_guardrail_event(
      'wave_heal_lf_coverage_dryrun',
      jsonb_build_object('run_id', v_run_id, 'count', jsonb_array_length(v_plan))
    );
    RETURN jsonb_build_object(
      'run_id', v_run_id, 'dry_run', true,
      'planned', jsonb_array_length(v_plan), 'plan', v_plan
    );
  END IF;

  -- Execute: insert one job per planned package with canonical payload (_origin set)
  WITH ins AS (
    INSERT INTO job_queue (
      job_type, package_id, status, priority, payload, run_after, created_at
    )
    SELECT
      CASE p->>'action'
        WHEN 'full_seed'      THEN 'package_auto_seed_exam_blueprints'
        WHEN 'targeted_seed'  THEN 'package_auto_seed_exam_blueprints'
        WHEN 'lf_repair_only' THEN 'package_repair_exam_pool_lf_coverage'
      END,
      (p->>'package_id')::uuid,
      'pending',
      5,
      jsonb_build_object(
        '_origin',         'wave_heal_lf_coverage',
        '_origin_run_id',  v_run_id,
        'package_id',      (p->>'package_id')::uuid,
        'curriculum_id',   (p->>'curriculum_id')::uuid,
        'mode',            p->>'action',
        'target_lfs',      COALESCE(p->'missing_bp_lfs', '[]'::jsonb),
        'target_per_lf',   _target_per_lf,
        'enqueue_source',  'admin_wave_heal_lf_coverage'
      ),
      now(),
      now()
    FROM jsonb_array_elements(v_plan) AS p
    RETURNING id, job_type, package_id, payload->>'_origin' AS origin
  )
  SELECT jsonb_agg(jsonb_build_object(
    'job_id', id, 'job_type', job_type, 'package_id', package_id, 'origin', origin
  )) INTO v_enqueued FROM ins;

  PERFORM public.fn_log_guardrail_event(
    'wave_heal_lf_coverage_executed',
    jsonb_build_object(
      'run_id', v_run_id,
      'enqueued', COALESCE(jsonb_array_length(v_enqueued), 0),
      'planned',  jsonb_array_length(v_plan)
    )
  );

  RETURN jsonb_build_object(
    'run_id',   v_run_id,
    'dry_run',  false,
    'planned',  jsonb_array_length(v_plan),
    'enqueued', COALESCE(jsonb_array_length(v_enqueued), 0),
    'jobs',     COALESCE(v_enqueued, '[]'::jsonb),
    'plan',     v_plan
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_wave_heal_lf_coverage(boolean, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wave_heal_lf_coverage(boolean, int, int) TO service_role;