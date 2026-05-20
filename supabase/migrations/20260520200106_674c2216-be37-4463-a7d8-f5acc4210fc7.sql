
-- ============================================================
-- C1: Helper für aktive Kinder eines lf_repair Parent-Jobs
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_lf_repair_has_active_children(p_parent_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_ids uuid[];
  v_active int;
BEGIN
  SELECT ARRAY(
    SELECT (val#>>'{}')::uuid
    FROM job_queue j,
         LATERAL jsonb_array_elements(COALESCE(j.meta->'child_job_ids','[]'::jsonb)) val
    WHERE j.id = p_parent_job_id
  ) INTO v_child_ids;

  IF v_child_ids IS NULL OR array_length(v_child_ids,1) IS NULL THEN
    RETURN false;
  END IF;

  SELECT COUNT(*) INTO v_active
  FROM job_queue
  WHERE id = ANY(v_child_ids)
    AND status IN ('pending','processing','queued','running');

  RETURN v_active > 0;
END
$$;

REVOKE ALL ON FUNCTION public.fn_lf_repair_has_active_children(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lf_repair_has_active_children(uuid) TO service_role;

-- ============================================================
-- C1: Cleanup — stuck lf_repair parents mit MAX_ATTEMPTS hart abschließen
-- (Auto-Healer ignoriert MAX_ATTEMPTS_EXHAUSTED bereits; hier nur eindeutiger Endzustand)
-- ============================================================
WITH stuck AS (
  SELECT id, package_id
  FROM job_queue
  WHERE job_type = 'package_repair_exam_pool_lf_coverage'
    AND status IN ('pending','processing','queued','running')
    AND attempts >= max_attempts
)
UPDATE job_queue jq
SET status = 'failed',
    completed_at = now(),
    last_error_code = COALESCE(last_error_code, 'MAX_ATTEMPTS_EXHAUSTED'),
    last_error = COALESCE(last_error, 'C1 cleanup: stuck parent finalized as failed')
FROM stuck s
WHERE jq.id = s.id;

INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
SELECT 'c1_lf_repair_max_attempts_terminal_cleanup', 'job', id, 'cleaned',
       jsonb_build_object('package_id', package_id, 'migration', '20260520_c1_c6_fail_reduction')
FROM job_queue
WHERE job_type = 'package_repair_exam_pool_lf_coverage'
  AND status = 'failed'
  AND completed_at > now() - interval '1 minute'
  AND last_error_code = 'MAX_ATTEMPTS_EXHAUSTED';

-- ============================================================
-- C6: enqueue_blueprint_gap_jobs — fan-out PER blueprint_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_blueprint_gap_jobs(
  p_curriculum_id uuid,
  p_cap integer DEFAULT 50,
  p_reason text DEFAULT 'gap_router'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap int := GREATEST(5, LEAST(COALESCE(p_cap, 50), 200));
  v_package_id uuid;
  v_ins int := 0;
  v_skipped_no_bp int := 0;
BEGIN
  -- Resolve package_id for this curriculum (latest building/published)
  SELECT id INTO v_package_id
  FROM public.course_packages
  WHERE curriculum_id = p_curriculum_id
  ORDER BY (status = 'building') DESC, updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_package_id IS NULL THEN
    RETURN jsonb_build_object(
      'curriculum_id', p_curriculum_id, 'cap', v_cap,
      'enqueued', 0, 'reason', 'no_package_for_curriculum', 'ts', now()
    );
  END IF;

  -- For each gap competency, expand to its approved blueprints and enqueue PER blueprint_id.
  WITH gaps AS (
    SELECT g.competency_id, g.gap_total, g.priority
    FROM public.get_blueprint_coverage_gaps(p_curriculum_id, 1) g
    ORDER BY g.priority DESC, g.gap_total DESC
    LIMIT v_cap
  ),
  expand AS (
    SELECT g.competency_id,
           g.gap_total,
           bp.id AS blueprint_id
    FROM gaps g
    JOIN public.question_blueprints bp
      ON bp.competency_id = g.competency_id
     AND bp.curriculum_id = p_curriculum_id
     AND bp.approved_at IS NOT NULL
     AND bp.deprecated_at IS NULL
     AND bp.status <> 'deprecated'
  ),
  no_bp_audit AS (
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    SELECT 'blueprint_gap_no_approved_blueprints', 'competency', g.competency_id, 'skipped',
           jsonb_build_object(
             'curriculum_id', p_curriculum_id,
             'package_id',    v_package_id,
             'gap_total',     g.gap_total,
             'reason',        p_reason
           )
    FROM gaps g
    WHERE NOT EXISTS (SELECT 1 FROM expand e WHERE e.competency_id = g.competency_id)
    RETURNING 1
  ),
  ins AS (
    INSERT INTO public.job_queue (
      job_type, status, payload, priority, max_attempts, package_id, worker_pool
    )
    SELECT
      'package_generate_blueprint_variants',
      'pending',
      jsonb_build_object(
        'curriculum_id',  p_curriculum_id::text,
        'package_id',     v_package_id::text,
        'competency_id',  e.competency_id::text,
        'blueprint_id',   e.blueprint_id::text,
        'count',          LEAST(5, GREATEST(1, e.gap_total)),
        'reason',         p_reason,
        '_origin',        'db:enqueue_blueprint_gap_jobs',
        'enqueue_source', 'db:enqueue_blueprint_gap_jobs'
      ),
      80, 3, v_package_id, 'default'
    FROM expand e
    ON CONFLICT DO NOTHING
    RETURNING 1
  ),
  skipped AS (
    SELECT COUNT(*) AS c FROM no_bp_audit
  )
  SELECT (SELECT COUNT(*) FROM ins), (SELECT c FROM skipped)
  INTO v_ins, v_skipped_no_bp;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'enqueue_blueprint_gap_jobs_per_blueprint_fanout',
    'package', v_package_id, 'success',
    jsonb_build_object(
      'curriculum_id', p_curriculum_id,
      'cap', v_cap,
      'enqueued', v_ins,
      'skipped_competencies_no_bp', v_skipped_no_bp,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'curriculum_id', p_curriculum_id,
    'package_id',    v_package_id,
    'cap',           v_cap,
    'enqueued',      v_ins,
    'skipped_competencies_no_bp', v_skipped_no_bp,
    'reason',        p_reason,
    'ts',            now()
  );
END
$$;
