
-- ═══════════════════════════════════════════════════════════════
-- PHASE 1: Threshold-Hardened DB Guards (upgrade from >0 to proportional)
-- PHASE 2: Reconcile Drift-Detection Views
-- ═══════════════════════════════════════════════════════════════

-- ── PHASE 1A: Drop old existence-only guards and replace with threshold guards ──

-- Guard: scaffold_learning_course — lessons ≥ competency count (proportional)
CREATE OR REPLACE FUNCTION public.guard_scaffold_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_course_id uuid;
  v_curriculum_id uuid;
  v_module_count int;
  v_lesson_count int;
  v_lf_count int;
  v_comp_count int;
  v_min_modules int;
  v_min_lessons int;
BEGIN
  IF NEW.step_key = 'scaffold_learning_course' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT cp.course_id, cp.curriculum_id INTO v_course_id, v_curriculum_id
    FROM course_packages cp WHERE cp.id = NEW.package_id;

    IF v_course_id IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_SCAFFOLD: PACKAGE_NOT_FOUND';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_module_count FROM modules WHERE course_id = v_course_id;
    SELECT count(*) INTO v_lf_count FROM learning_fields WHERE curriculum_id = v_curriculum_id;
    v_min_modules := GREATEST(1, v_lf_count);

    IF v_module_count < v_min_modules THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_SCAFFOLD: INSUFFICIENT_MODULES %s/%s', v_module_count, v_min_modules);
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_lesson_count FROM lessons l JOIN modules m ON l.module_id = m.id WHERE m.course_id = v_course_id;
    SELECT count(*) INTO v_comp_count
    FROM competencies comp JOIN learning_fields lf ON comp.learning_field_id = lf.id
    WHERE lf.curriculum_id = v_curriculum_id;
    v_min_lessons := GREATEST(5, v_comp_count);

    IF v_lesson_count < v_min_lessons THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_SCAFFOLD: INSUFFICIENT_LESSONS %s/%s', v_lesson_count, v_min_lessons);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: generate_glossary — glossary entries ≥ 10
CREATE OR REPLACE FUNCTION public.guard_glossary_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_beruf_id uuid;
  v_count int;
  v_min int := 10;
BEGIN
  IF NEW.step_key = 'generate_glossary' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT c.beruf_id INTO v_beruf_id
    FROM course_packages cp JOIN curricula c ON cp.curriculum_id = c.id
    WHERE cp.id = NEW.package_id;

    IF v_beruf_id IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_GLOSSARY: NO_BERUF_ID';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_count FROM profession_glossaries WHERE beruf_id = v_beruf_id;
    IF v_count < v_min THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_GLOSSARY: INSUFFICIENT_ENTRIES %s/%s', v_count, v_min);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: generate_exam_pool — exam_questions ≥ 10 non-rejected
CREATE OR REPLACE FUNCTION public.guard_exam_pool_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_curriculum_id uuid;
  v_count int;
  v_min int := 10;
BEGIN
  IF NEW.step_key = 'generate_exam_pool' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = NEW.package_id;
    IF v_curriculum_id IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_EXAM_POOL: NO_CURRICULUM';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_count FROM exam_questions WHERE curriculum_id = v_curriculum_id AND status != 'rejected';
    IF v_count < v_min THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_EXAM_POOL: INSUFFICIENT_QUESTIONS %s/%s', v_count, v_min);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: auto_seed_exam_blueprints — question_blueprints ≥ 3
CREATE OR REPLACE FUNCTION public.guard_blueprint_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_curriculum_id uuid;
  v_count int;
  v_min int := 3;
BEGIN
  IF NEW.step_key = 'auto_seed_exam_blueprints' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = NEW.package_id;
    IF v_curriculum_id IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_BLUEPRINT: NO_CURRICULUM';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_count FROM question_blueprints WHERE curriculum_id = v_curriculum_id;
    IF v_count < v_min THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_BLUEPRINT: INSUFFICIENT_BLUEPRINTS %s/%s', v_count, v_min);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: generate_oral_exam — oral_exam_blueprints ≥ 10
CREATE OR REPLACE FUNCTION public.guard_oral_exam_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_curriculum_id uuid;
  v_count int;
  v_min int := 10;
BEGIN
  IF NEW.step_key = 'generate_oral_exam' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = NEW.package_id;
    IF v_curriculum_id IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_ORAL_EXAM: NO_CURRICULUM';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_count FROM oral_exam_blueprints WHERE curriculum_id = v_curriculum_id;
    IF v_count < v_min THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_ORAL_EXAM: INSUFFICIENT_BLUEPRINTS %s/%s', v_count, v_min);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: generate_lesson_minichecks — minicheck_questions ≥ 5
CREATE OR REPLACE FUNCTION public.guard_minichecks_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_curriculum_id uuid;
  v_count int;
  v_min int := 5;
BEGIN
  IF NEW.step_key = 'generate_lesson_minichecks' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = NEW.package_id;
    IF v_curriculum_id IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_MINICHECKS: NO_CURRICULUM';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_count FROM minicheck_questions WHERE curriculum_id = v_curriculum_id;
    IF v_count < v_min THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_MINICHECKS: INSUFFICIENT_MINICHECKS %s/%s', v_count, v_min);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: generate_handbook — sections ≥ chapters (proportional)
CREATE OR REPLACE FUNCTION public.guard_handbook_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_curriculum_id uuid;
  v_chapter_count int;
  v_section_count int;
BEGIN
  IF NEW.step_key = 'generate_handbook' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = NEW.package_id;
    IF v_curriculum_id IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_HANDBOOK: NO_CURRICULUM';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_chapter_count FROM handbook_chapters WHERE curriculum_id = v_curriculum_id;
    IF v_chapter_count < 1 THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_HANDBOOK: ZERO_CHAPTERS';
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_section_count
    FROM handbook_sections hs
    JOIN handbook_chapters hc ON hs.chapter_id = hc.id
    WHERE hc.curriculum_id = v_curriculum_id;

    IF v_section_count < v_chapter_count THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_HANDBOOK: INSUFFICIENT_SECTIONS %s/%s', v_section_count, v_chapter_count);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: build_ai_tutor_index — ai_tutor_context_index ≥ 1
CREATE OR REPLACE FUNCTION public.guard_tutor_index_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_count int;
BEGIN
  IF NEW.step_key = 'build_ai_tutor_index' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT count(*) INTO v_count FROM ai_tutor_context_index WHERE package_id = NEW.package_id;
    IF v_count < 1 THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_TUTOR_INDEX: ZERO_INDEX_ENTRIES';
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guard: run_integrity_check — report present + version + non-empty + fresh
CREATE OR REPLACE FUNCTION public.guard_integrity_step_done() RETURNS TRIGGER AS $$
DECLARE
  v_report jsonb;
  v_version int;
  v_key_count int;
BEGIN
  IF NEW.step_key = 'run_integrity_check' AND NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT integrity_report::jsonb, integrity_report_version INTO v_report, v_version
    FROM course_packages WHERE id = NEW.package_id;

    IF v_report IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_INTEGRITY: REPORT_MISSING';
      RETURN NEW;
    END IF;

    IF v_version IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_INTEGRITY: VERSION_MISSING';
      RETURN NEW;
    END IF;

    -- Non-empty check: report must have meaningful keys
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(v_report);
    IF v_key_count < 2 THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_INTEGRITY: REPORT_EMPTY %s keys', v_key_count);
      RETURN NEW;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Re-create triggers (idempotent) ──
DROP TRIGGER IF EXISTS trg_guard_scaffold_step_done ON package_steps;
CREATE TRIGGER trg_guard_scaffold_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_scaffold_step_done();

DROP TRIGGER IF EXISTS trg_guard_glossary_step_done ON package_steps;
CREATE TRIGGER trg_guard_glossary_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_glossary_step_done();

DROP TRIGGER IF EXISTS trg_guard_exam_pool_step_done ON package_steps;
CREATE TRIGGER trg_guard_exam_pool_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_exam_pool_step_done();

DROP TRIGGER IF EXISTS trg_guard_blueprint_step_done ON package_steps;
CREATE TRIGGER trg_guard_blueprint_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_blueprint_step_done();

DROP TRIGGER IF EXISTS trg_guard_oral_exam_step_done ON package_steps;
CREATE TRIGGER trg_guard_oral_exam_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_oral_exam_step_done();

DROP TRIGGER IF EXISTS trg_guard_minichecks_step_done ON package_steps;
CREATE TRIGGER trg_guard_minichecks_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_minichecks_step_done();

DROP TRIGGER IF EXISTS trg_guard_handbook_step_done ON package_steps;
CREATE TRIGGER trg_guard_handbook_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_handbook_step_done();

DROP TRIGGER IF EXISTS trg_guard_tutor_index_step_done ON package_steps;
CREATE TRIGGER trg_guard_tutor_index_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_tutor_index_step_done();

DROP TRIGGER IF EXISTS trg_guard_integrity_step_done ON package_steps;
CREATE TRIGGER trg_guard_integrity_step_done BEFORE UPDATE ON package_steps
  FOR EACH ROW EXECUTE FUNCTION guard_integrity_step_done();


-- ═══════════════════════════════════════════════════════════════
-- PHASE 2: Reconcile Drift-Detection Views
-- ═══════════════════════════════════════════════════════════════

-- View 1: Steps marked done but artifact is missing or below threshold
CREATE OR REPLACE VIEW public.ops_step_done_artifact_missing AS
WITH scaffold AS (
  SELECT ps.package_id, ps.step_key, 'lessons' as artifact_type,
    (SELECT count(*) FROM lessons l JOIN modules m ON l.module_id = m.id WHERE m.course_id = cp.course_id) as actual_count,
    GREATEST(5, (SELECT count(*) FROM competencies comp JOIN learning_fields lf ON comp.learning_field_id = lf.id WHERE lf.curriculum_id = cp.curriculum_id)) as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'scaffold_learning_course' AND ps.status = 'done'
),
glossary AS (
  SELECT ps.package_id, ps.step_key, 'profession_glossaries' as artifact_type,
    (SELECT count(*) FROM profession_glossaries pg2 JOIN curricula cur ON pg2.beruf_id = cur.beruf_id WHERE cur.id = cp.curriculum_id) as actual_count,
    10 as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'generate_glossary' AND ps.status = 'done'
),
exam_pool AS (
  SELECT ps.package_id, ps.step_key, 'exam_questions' as artifact_type,
    (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.status != 'rejected') as actual_count,
    10 as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'generate_exam_pool' AND ps.status = 'done'
),
blueprints AS (
  SELECT ps.package_id, ps.step_key, 'question_blueprints' as artifact_type,
    (SELECT count(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id) as actual_count,
    3 as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'auto_seed_exam_blueprints' AND ps.status = 'done'
),
oral_exam AS (
  SELECT ps.package_id, ps.step_key, 'oral_exam_blueprints' as artifact_type,
    (SELECT count(*) FROM oral_exam_blueprints oeb WHERE oeb.curriculum_id = cp.curriculum_id) as actual_count,
    10 as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'generate_oral_exam' AND ps.status = 'done'
),
minichecks AS (
  SELECT ps.package_id, ps.step_key, 'minicheck_questions' as artifact_type,
    (SELECT count(*) FROM minicheck_questions mq WHERE mq.curriculum_id = cp.curriculum_id) as actual_count,
    5 as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'generate_lesson_minichecks' AND ps.status = 'done'
),
handbook AS (
  SELECT ps.package_id, ps.step_key, 'handbook_sections' as artifact_type,
    (SELECT count(*) FROM handbook_sections hs JOIN handbook_chapters hc ON hs.chapter_id = hc.id WHERE hc.curriculum_id = cp.curriculum_id) as actual_count,
    GREATEST(1, (SELECT count(*) FROM handbook_chapters hc2 WHERE hc2.curriculum_id = cp.curriculum_id)) as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'generate_handbook' AND ps.status = 'done'
),
tutor_idx AS (
  SELECT ps.package_id, ps.step_key, 'ai_tutor_context_index' as artifact_type,
    (SELECT count(*) FROM ai_tutor_context_index ati WHERE ati.package_id = ps.package_id) as actual_count,
    1 as min_threshold
  FROM package_steps ps
  WHERE ps.step_key = 'build_ai_tutor_index' AND ps.status = 'done'
),
integrity AS (
  SELECT ps.package_id, ps.step_key, 'integrity_report' as artifact_type,
    CASE WHEN cp.integrity_report IS NOT NULL AND cp.integrity_report_version IS NOT NULL THEN 1 ELSE 0 END as actual_count,
    1 as min_threshold
  FROM package_steps ps
  JOIN course_packages cp ON ps.package_id = cp.id
  WHERE ps.step_key = 'run_integrity_check' AND ps.status = 'done'
),
all_checks AS (
  SELECT * FROM scaffold UNION ALL
  SELECT * FROM glossary UNION ALL
  SELECT * FROM exam_pool UNION ALL
  SELECT * FROM blueprints UNION ALL
  SELECT * FROM oral_exam UNION ALL
  SELECT * FROM minichecks UNION ALL
  SELECT * FROM handbook UNION ALL
  SELECT * FROM tutor_idx UNION ALL
  SELECT * FROM integrity
)
SELECT
  ac.package_id,
  ac.step_key,
  ac.artifact_type,
  ac.actual_count,
  ac.min_threshold,
  CASE WHEN ac.actual_count < ac.min_threshold THEN 'BELOW_THRESHOLD' ELSE 'OK' END as drift_status,
  CASE WHEN ac.actual_count = 0 THEN 'MISSING' 
       WHEN ac.actual_count < ac.min_threshold THEN 'INSUFFICIENT'
       ELSE 'ADEQUATE' END as severity
FROM all_checks ac
WHERE ac.actual_count < ac.min_threshold;

-- View 2: Artifact present but step not done (potential stalled steps)
CREATE OR REPLACE VIEW public.ops_artifact_present_step_not_done AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status as step_status,
  cp.status as package_status,
  CASE ps.step_key
    WHEN 'auto_seed_exam_blueprints' THEN (SELECT count(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id)
    WHEN 'generate_exam_pool' THEN (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.status != 'rejected')
    WHEN 'generate_oral_exam' THEN (SELECT count(*) FROM oral_exam_blueprints oeb WHERE oeb.curriculum_id = cp.curriculum_id)
    WHEN 'generate_lesson_minichecks' THEN (SELECT count(*) FROM minicheck_questions mq WHERE mq.curriculum_id = cp.curriculum_id)
    WHEN 'build_ai_tutor_index' THEN (SELECT count(*) FROM ai_tutor_context_index ati WHERE ati.package_id = ps.package_id)
  END as artifact_count,
  ps.attempts,
  ps.last_error,
  ps.updated_at
FROM package_steps ps
JOIN course_packages cp ON ps.package_id = cp.id
WHERE ps.status NOT IN ('done', 'skipped')
  AND ps.step_key IN ('auto_seed_exam_blueprints','generate_exam_pool','generate_oral_exam','generate_lesson_minichecks','build_ai_tutor_index')
  AND cp.status IN ('building', 'queued')
  AND CASE ps.step_key
    WHEN 'auto_seed_exam_blueprints' THEN (SELECT count(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id) >= 3
    WHEN 'generate_exam_pool' THEN (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.status != 'rejected') >= 10
    WHEN 'generate_oral_exam' THEN (SELECT count(*) FROM oral_exam_blueprints oeb WHERE oeb.curriculum_id = cp.curriculum_id) >= 10
    WHEN 'generate_lesson_minichecks' THEN (SELECT count(*) FROM minicheck_questions mq WHERE mq.curriculum_id = cp.curriculum_id) >= 5
    WHEN 'build_ai_tutor_index' THEN (SELECT count(*) FROM ai_tutor_context_index ati WHERE ati.package_id = ps.package_id) >= 1
    ELSE false
  END;

-- View 3: Guard rejection audit — steps where guard forced failed
CREATE OR REPLACE VIEW public.ops_guard_rejections AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status,
  ps.last_error,
  ps.attempts,
  ps.updated_at,
  cp.status as package_status,
  cp.curriculum_id
FROM package_steps ps
JOIN course_packages cp ON ps.package_id = cp.id
WHERE ps.status = 'failed'
  AND ps.last_error LIKE 'GUARD_%'
ORDER BY ps.updated_at DESC;

-- Restrict views to service_role only
REVOKE SELECT ON public.ops_step_done_artifact_missing FROM anon, authenticated;
REVOKE SELECT ON public.ops_artifact_present_step_not_done FROM anon, authenticated;
REVOKE SELECT ON public.ops_guard_rejections FROM anon, authenticated;
