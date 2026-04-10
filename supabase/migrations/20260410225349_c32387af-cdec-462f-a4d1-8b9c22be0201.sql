
-- ═══════════════════════════════════════════════════════════════
-- 1. SSOT Function
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_expected_steps_for_track(p_track text)
RETURNS TABLE(step_key text, is_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track text := upper(trim(p_track));
BEGIN
  RETURN QUERY
  SELECT s.sk,
    CASE
      WHEN s.sk IN ('scaffold_learning_course','generate_glossary','fanout_learning_content',
                     'generate_learning_content','finalize_learning_content','validate_learning_content')
        THEN v_track NOT IN ('EXAM_FIRST','EXAM_FIRST_PLUS')
      WHEN s.sk IN ('generate_lesson_minichecks','validate_lesson_minichecks')
        THEN v_track = 'AUSBILDUNG_VOLL'
      WHEN s.sk IN ('enqueue_handbook_expand','expand_handbook','validate_handbook_depth')
        THEN v_track = 'AUSBILDUNG_VOLL'
      WHEN s.sk IN ('generate_oral_exam','validate_oral_exam')
        THEN v_track IN ('AUSBILDUNG_VOLL','EXAM_FIRST_PLUS')
      WHEN s.sk IN ('build_ai_tutor_index','validate_tutor_index')
        THEN v_track = 'AUSBILDUNG_VOLL'
      WHEN s.sk = 'elite_harden'
        THEN v_track IN ('AUSBILDUNG_VOLL','EXAM_FIRST_PLUS')
      ELSE true
    END
  FROM (VALUES
    ('scaffold_learning_course'),('generate_glossary'),('fanout_learning_content'),
    ('generate_learning_content'),('finalize_learning_content'),('validate_learning_content'),
    ('auto_seed_exam_blueprints'),('validate_blueprints'),
    ('generate_blueprint_variants'),('validate_blueprint_variants'),('promote_blueprint_variants'),
    ('generate_exam_pool'),('validate_exam_pool'),('repair_exam_pool_quality'),
    ('build_ai_tutor_index'),('validate_tutor_index'),
    ('generate_oral_exam'),('validate_oral_exam'),
    ('generate_lesson_minichecks'),('validate_lesson_minichecks'),
    ('generate_handbook'),('validate_handbook'),
    ('enqueue_handbook_expand'),('expand_handbook'),('validate_handbook_depth'),
    ('elite_harden'),('run_integrity_check'),('quality_council'),('auto_publish')
  ) AS s(sk);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Audit View
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.ops_step_ssot_drift AS
WITH expected AS (
  SELECT cp.id AS package_id, cp.track::text AS track, e.step_key, e.is_required
  FROM course_packages cp
  CROSS JOIN LATERAL fn_expected_steps_for_track(cp.track::text) e
  WHERE cp.status IN ('building','blocked','quality_gate_failed','ready')
),
actual AS (
  SELECT ps.package_id, ps.step_key::text AS step_key, ps.status
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE cp.status IN ('building','blocked','quality_gate_failed','ready')
)
SELECT
  e.package_id, e.track, e.step_key, e.is_required,
  a.status AS actual_status,
  CASE
    WHEN a.step_key IS NULL THEN 'MISSING_STEP'
    WHEN e.is_required = false AND a.status NOT IN ('skipped','done') THEN 'SHOULD_BE_SKIPPED'
    WHEN e.is_required = true AND a.status = 'skipped' THEN 'WRONGLY_SKIPPED'
    ELSE 'OK'
  END AS drift_type
FROM expected e
LEFT JOIN actual a ON a.package_id = e.package_id AND a.step_key = e.step_key
WHERE a.step_key IS NULL
  OR (e.is_required = false AND a.status NOT IN ('skipped','done'))
  OR (e.is_required = true AND a.status = 'skipped');

-- ═══════════════════════════════════════════════════════════════
-- 3. Legacy Step Guard
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_guard_canonical_step_keys()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_canonical text[] := ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
    'build_ai_tutor_index','validate_tutor_index',
    'generate_oral_exam','validate_oral_exam',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_handbook','validate_handbook',
    'enqueue_handbook_expand','expand_handbook','validate_handbook_depth',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ];
BEGIN
  IF NEW.step_key::text != ALL(v_canonical) THEN
    RAISE EXCEPTION 'LEGACY_STEP_BLOCKED: step_key "%" is not in canonical 29-step SSOT', NEW.step_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_canonical_step_keys ON package_steps;
CREATE TRIGGER trg_guard_canonical_step_keys
  BEFORE INSERT ON package_steps
  FOR EACH ROW EXECUTE FUNCTION trg_guard_canonical_step_keys();

-- ═══════════════════════════════════════════════════════════════
-- 4. Smart Zombie Recovery
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_smart_zombie_recovery()
RETURNS TABLE(job_id uuid, job_type text, pkg_id uuid, zombie_class text, action_taken text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT jq.id, jq.job_type, jq.package_id,
    CASE
      WHEN jq.attempts >= 5 THEN 'POISON_LOOP'
      WHEN jq.attempts >= 3 AND jq.last_error ILIKE '%STALE_LOCK%' THEN 'STALE_LOCK_RECURRENT'
      WHEN EXTRACT(EPOCH FROM (now() - jq.locked_at)) > 600 THEN 'HARD_ZOMBIE'
      WHEN EXTRACT(EPOCH FROM (now() - jq.locked_at)) > 300 THEN 'SOFT_ZOMBIE'
      ELSE 'ALIVE'
    END,
    CASE
      WHEN jq.attempts >= 5 THEN 'TERMINATED'
      WHEN jq.attempts >= 3 AND jq.last_error ILIKE '%STALE_LOCK%' THEN 'TERMINATED'
      WHEN EXTRACT(EPOCH FROM (now() - jq.locked_at)) > 300 THEN 'RESET_TO_PENDING'
      ELSE 'SKIPPED'
    END
  FROM job_queue jq
  WHERE jq.status = 'processing' AND jq.locked_at < now() - interval '300 seconds';

  -- Terminate poison/stale
  UPDATE job_queue SET status = 'failed', locked_by = NULL, locked_at = NULL,
    last_error = 'ZOMBIE_TERMINATED_SMART'
  WHERE status = 'processing' AND locked_at < now() - interval '300 seconds'
    AND (attempts >= 5 OR (attempts >= 3 AND last_error ILIKE '%STALE_LOCK%'));

  -- Reset recoverable
  UPDATE job_queue SET status = 'pending', locked_by = NULL, locked_at = NULL,
    last_error = 'ZOMBIE_RESET_SMART_' || now()::text
  WHERE status = 'processing' AND locked_at < now() - interval '300 seconds'
    AND attempts < 5 AND NOT (attempts >= 3 AND last_error ILIKE '%STALE_LOCK%');
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 5. Fail Classification View
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.ops_validate_exam_pool_fail_classification AS
SELECT
  cp.id AS package_id,
  cp.track::text AS track,
  cp.status AS pkg_status,
  ps.last_error,
  CASE
    WHEN ps.last_error ILIKE '%HARD_FAIL_NO_BLUEPRINTS%' THEN 'NO_BLUEPRINTS'
    WHEN ps.last_error ILIKE '%HARD_FAIL_NO_CURRICULUM%' THEN 'NO_CURRICULUM'
    WHEN ps.last_error ILIKE '%HARD_FAIL_GENERATION_NEVER_RAN%' THEN 'GENERATION_NEVER_RAN'
    WHEN ps.last_error ILIKE '%REPAIR_EXHAUSTED%' THEN 'REPAIR_EXHAUSTED'
    WHEN ps.last_error ILIKE '%LF_COVERAGE%' THEN 'LF_COVERAGE_GAP'
    ELSE 'OTHER'
  END AS fail_class,
  (SELECT count(*) FROM exam_questions eq 
   WHERE eq.curriculum_id = cp.curriculum_id) AS exam_q_count,
  (SELECT count(*) FROM exam_blueprints eb 
   WHERE eb.curriculum_id = cp.curriculum_id) AS blueprint_count
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.step_key = 'validate_exam_pool' AND ps.status = 'failed';
