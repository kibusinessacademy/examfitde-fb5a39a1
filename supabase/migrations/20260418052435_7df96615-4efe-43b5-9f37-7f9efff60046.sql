-- ════════════════════════════════════════════════════════════════════
-- admin_manual_heal_package: SSOT-konformer manueller Heal mit Bypass
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_manual_heal_package(
  p_package_id uuid,
  p_reset_from_step text,
  p_cancel_active_jobs boolean DEFAULT true,
  p_reason text DEFAULT 'admin_manual_heal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_step_idx int;
  v_step_keys_to_reset text[] := ARRAY[]::text[];
  v_cancelled_jobs int := 0;
  v_reset_steps int := 0;
  v_now timestamptz := now();
BEGIN
  -- Load package
  SELECT * INTO v_pkg FROM course_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PACKAGE_NOT_FOUND');
  END IF;

  -- 1. Cancel active jobs
  IF p_cancel_active_jobs THEN
    UPDATE job_queue
       SET status = 'cancelled',
           completed_at = v_now,
           last_error = 'admin_manual_heal: cancelled to allow re-enter',
           updated_at = v_now,
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
             'transition_source','admin_manual_heal',
             'transition_reason', p_reason,
             'transition_at', v_now
           )
     WHERE package_id = p_package_id
       AND status IN ('pending','queued','processing');
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
  END IF;

  -- 2. Determine steps to reset (provided step + all queued steps that are NOT done/skipped)
  IF p_reset_from_step IS NOT NULL THEN
    SELECT array_agg(step_key) INTO v_step_keys_to_reset
      FROM package_steps
     WHERE package_id = p_package_id
       AND status NOT IN ('done','skipped');
  END IF;

  IF v_step_keys_to_reset IS NOT NULL AND array_length(v_step_keys_to_reset,1) > 0 THEN
    UPDATE package_steps
       SET status = 'queued',
           attempts = 0,
           started_at = NULL,
           finished_at = NULL,
           last_error = NULL,
           runner_id = NULL,
           last_heartbeat_at = NULL,
           updated_at = v_now,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'allow_regression', true,
             'allow_regression_by', 'admin_manual',
             'manual_heal_reason', p_reason,
             'manual_heal_at', v_now
           )
     WHERE package_id = p_package_id
       AND step_key = ANY(v_step_keys_to_reset);
    GET DIAGNOSTICS v_reset_steps = ROW_COUNT;
  END IF;

  -- 3. Force package back to building, clear blocked_reason cleanly
  UPDATE course_packages
     SET status = 'building',
         blocked_reason = NULL,
         blocked_by = NULL,
         blocked_at = NULL,
         stuck_reason = NULL,
         locked_at = NULL,
         last_progress_at = v_now,
         updated_at = v_now,
         retry_count = 0
   WHERE id = p_package_id;

  -- 4. Audit log (best-effort)
  BEGIN
    INSERT INTO admin_actions(action, payload, after_state, affected_ids, scope)
    VALUES (
      'admin_manual_heal_package',
      jsonb_build_object('package_id', p_package_id, 'reset_from_step', p_reset_from_step, 'reason', p_reason),
      jsonb_build_object('cancelled_jobs', v_cancelled_jobs, 'reset_steps', v_reset_steps),
      ARRAY[p_package_id::text],
      'manual_heal'
    );
  EXCEPTION WHEN OTHERS THEN /* best-effort */ NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'cancelled_jobs', v_cancelled_jobs,
    'reset_steps', v_reset_steps,
    'reset_step_keys', v_step_keys_to_reset,
    'reason', p_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_manual_heal_package(uuid,text,boolean,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_manual_heal_package IS 
'Manueller Heal-Bypass: cancelt active jobs, reset steps mit allow_regression, klärt blocked state. SSOT-Bypass-Pfad für Notfälle.';

-- ════════════════════════════════════════════════════════════════════
-- Heal-Ausführung der 5 festgefahrenen Pakete
-- ════════════════════════════════════════════════════════════════════

-- 1) DSGVO d2000000-0015 (EXAM_FIRST, 0 questions, 0 lessons)
DO $heal$
DECLARE r jsonb;
BEGIN
  SELECT admin_manual_heal_package(
    'd2000000-0015-4000-8000-000000000001'::uuid,
    'generate_exam_pool',
    true,
    'manual_heal_dsgvo_pool_zero'
  ) INTO r;
  RAISE NOTICE 'DSGVO heal: %', r;
END $heal$;

-- 2) Logistik 21f0b991 (Loop-Killer, 60q, 2/4 LF)
DO $heal$
DECLARE r jsonb; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM course_packages WHERE id::text LIKE '21f0b991%' LIMIT 1;
  SELECT admin_manual_heal_package(v_id, 'generate_exam_pool', true, 'manual_heal_loop_killer_repair_no_effect') INTO r;
  RAISE NOTICE 'Logistik heal: %', r;
END $heal$;

-- 3) Beruflicher Betreuer 3f416f2f (ZERTIFIKAT, 0 lessons, 0 questions)
DO $heal$
DECLARE r jsonb; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM course_packages WHERE id::text LIKE '3f416f2f%' LIMIT 1;
  SELECT admin_manual_heal_package(v_id, 'scaffold_learning_course', true, 'manual_heal_zertifikat_full_scaffold') INTO r;
  RAISE NOTICE 'Betreuer heal: %', r;
END $heal$;

-- 4) Restaurants 03287d1e (EXAM_FIRST, 159q, 3/12 LF) - Coverage Repair
DO $heal$
DECLARE r jsonb; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM course_packages WHERE id::text LIKE '03287d1e%' LIMIT 1;
  SELECT admin_manual_heal_package(v_id, 'repair_exam_pool_quality', true, 'manual_heal_lf_comp_coverage_repair') INTO r;
  RAISE NOTICE 'Restaurants heal: %', r;
END $heal$;

-- 5) Maskenbildner 015e3cc4 (EXAM_FIRST, 70q, 2/12 LF) - Coverage Repair
DO $heal$
DECLARE r jsonb; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM course_packages WHERE id::text LIKE '015e3cc4%' LIMIT 1;
  SELECT admin_manual_heal_package(v_id, 'repair_exam_pool_quality', true, 'manual_heal_lf_comp_coverage_repair') INTO r;
  RAISE NOTICE 'Maskenbildner heal: %', r;
END $heal$;

-- ════════════════════════════════════════════════════════════════════
-- Targeted Repair Jobs für jedes Paket (Echtdaten-getrieben)
-- ════════════════════════════════════════════════════════════════════

-- DSGVO: Vollständiger generate_exam_pool von 0
INSERT INTO job_queue (job_type, status, package_id, priority, payload, created_at, run_after)
SELECT 'package_generate_exam_pool', 'pending', id, 5,
  jsonb_build_object(
    'package_id', id,
    'curriculum_id', curriculum_id,
    'source', 'admin_manual_heal',
    'is_repair', true,
    'force_full_generation', true,
    'targets', jsonb_build_object('total_questions', 60, 'lf_coverage_pct', 100, 'comp_coverage_pct', 85, 'hardish_pct', 35)
  ),
  now(), now()
FROM course_packages WHERE id = 'd2000000-0015-4000-8000-000000000001'::uuid;

-- Logistik: Targeted full regen mit härteren targets (LF coverage)
INSERT INTO job_queue (job_type, status, package_id, priority, payload, created_at, run_after)
SELECT 'package_generate_exam_pool', 'pending', id, 5,
  jsonb_build_object(
    'package_id', id,
    'curriculum_id', curriculum_id,
    'source', 'admin_manual_heal',
    'is_repair', true,
    'force_full_generation', true,
    'targets', jsonb_build_object('total_questions', 120, 'lf_coverage_pct', 100, 'comp_coverage_pct', 85, 'hardish_pct', 45, 'reduce_remember_to_pct_max', 20)
  ),
  now(), now()
FROM course_packages WHERE id::text LIKE '21f0b991%';

-- Beruflicher Betreuer: Vollständiger Scaffold (es ist 0 lessons, 0 questions, ZERTIFIKAT)
INSERT INTO job_queue (job_type, status, package_id, priority, payload, created_at, run_after)
SELECT 'package_scaffold_learning_course', 'pending', id, 5,
  jsonb_build_object(
    'package_id', id,
    'curriculum_id', curriculum_id,
    'source', 'admin_manual_heal',
    'is_repair', true,
    'force_full_scaffold', true
  ),
  now(), now()
FROM course_packages WHERE id::text LIKE '3f416f2f%';

-- Restaurants: LF Coverage Pool-Fill (3/12 → 12/12)
INSERT INTO job_queue (job_type, status, package_id, priority, payload, created_at, run_after)
SELECT 'package_repair_exam_pool_lf_coverage', 'pending', id, 5,
  jsonb_build_object(
    'package_id', id,
    'curriculum_id', curriculum_id,
    'source', 'admin_manual_heal',
    'is_repair', true,
    'targets', jsonb_build_object('lf_target_total', 15, 'min_lf_coverage_pct', 100)
  ),
  now(), now()
FROM course_packages WHERE id::text LIKE '03287d1e%';

-- Restaurants: Quality repair für 12/40 comp coverage
INSERT INTO job_queue (job_type, status, package_id, priority, payload, created_at, run_after)
SELECT 'package_repair_exam_pool_quality', 'pending', id, 6,
  jsonb_build_object(
    'package_id', id,
    'curriculum_id', curriculum_id,
    'source', 'admin_manual_heal',
    'is_repair', true,
    'targets', jsonb_build_object('comp_coverage_pct', 85, 'hardish_pct', 35)
  ),
  now(), now() + interval '5 minutes'
FROM course_packages WHERE id::text LIKE '03287d1e%';

-- Maskenbildner: LF Coverage Pool-Fill (2/12 → 12/12) + Comp Coverage (5/47 → 85%)
INSERT INTO job_queue (job_type, status, package_id, priority, payload, created_at, run_after)
SELECT 'package_repair_exam_pool_lf_coverage', 'pending', id, 5,
  jsonb_build_object(
    'package_id', id,
    'curriculum_id', curriculum_id,
    'source', 'admin_manual_heal',
    'is_repair', true,
    'targets', jsonb_build_object('lf_target_total', 8, 'min_lf_coverage_pct', 100)
  ),
  now(), now()
FROM course_packages WHERE id::text LIKE '015e3cc4%';

INSERT INTO job_queue (job_type, status, package_id, priority, payload, created_at, run_after)
SELECT 'package_repair_exam_pool_quality', 'pending', id, 6,
  jsonb_build_object(
    'package_id', id,
    'curriculum_id', curriculum_id,
    'source', 'admin_manual_heal',
    'is_repair', true,
    'targets', jsonb_build_object('comp_coverage_pct', 85, 'hardish_pct', 35)
  ),
  now(), now() + interval '5 minutes'
FROM course_packages WHERE id::text LIKE '015e3cc4%';