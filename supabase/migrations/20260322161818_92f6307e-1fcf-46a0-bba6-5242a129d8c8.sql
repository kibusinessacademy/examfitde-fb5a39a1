
-- ═══════════════════════════════════════════════════════════════════════
-- P0 HARDENING: Fail-closed DB trigger guards for ALL generation steps
-- 
-- Problem: Only 2/23 pipeline steps had DB-level guards. The zombie
-- scanner (stuck-scan) can force ANY step to 'done' bypassing runtime
-- verifiers. This migration adds BEFORE UPDATE triggers that reject
-- done-transitions when zero artifacts are materialized.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. scaffold_learning_course: requires modules + lessons ──────────

CREATE OR REPLACE FUNCTION public.guard_scaffold_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_course_id uuid;
  v_lesson_count integer;
BEGIN
  IF NEW.step_key <> 'scaffold_learning_course' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT course_id INTO v_course_id FROM course_packages WHERE id = NEW.package_id;
  IF v_course_id IS NULL THEN
    RAISE EXCEPTION 'SCAFFOLD_GUARD: no course_id for package %', NEW.package_id;
  END IF;

  SELECT count(*) INTO v_lesson_count
  FROM lessons l JOIN modules m ON l.module_id = m.id
  WHERE m.course_id = v_course_id;

  IF v_lesson_count < 1 THEN
    NEW.status := 'failed';
    NEW.last_error := 'ZERO_LESSONS_MATERIALIZED: guard rejected done with 0 lessons';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_scaffold_step_done', 'lesson_count', v_lesson_count
    );
    RAISE WARNING 'SCAFFOLD_GUARD: rejected done for package % — 0 lessons', NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_scaffold_step_done ON package_steps;
CREATE TRIGGER trg_guard_scaffold_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_scaffold_step_done();

-- ── 2. generate_glossary: requires profession_glossaries ─────────────

CREATE OR REPLACE FUNCTION public.guard_glossary_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curriculum_id uuid;
  v_beruf_id uuid;
  v_count integer;
BEGIN
  IF NEW.step_key <> 'generate_glossary' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = NEW.package_id;
  SELECT beruf_id INTO v_beruf_id FROM curricula WHERE id = v_curriculum_id;

  IF v_beruf_id IS NULL THEN
    RAISE EXCEPTION 'GLOSSARY_GUARD: no beruf_id for curriculum % / package %', v_curriculum_id, NEW.package_id;
  END IF;

  SELECT count(*) INTO v_count FROM profession_glossaries WHERE beruf_id = v_beruf_id;

  IF v_count < 1 THEN
    NEW.status := 'failed';
    NEW.last_error := 'ZERO_GLOSSARY_MATERIALIZED: guard rejected done with 0 glossary entries';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_glossary_step_done', 'glossary_count', v_count
    );
    RAISE WARNING 'GLOSSARY_GUARD: rejected done for package % — 0 glossary', NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_glossary_step_done ON package_steps;
CREATE TRIGGER trg_guard_glossary_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_glossary_step_done();

-- ── 3. generate_exam_pool: requires exam_questions ───────────────────

CREATE OR REPLACE FUNCTION public.guard_exam_pool_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curriculum_id uuid;
  v_count integer;
BEGIN
  IF NEW.step_key <> 'generate_exam_pool' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = NEW.package_id;
  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'EXAM_POOL_GUARD: no curriculum_id for package %', NEW.package_id;
  END IF;

  SELECT count(*) INTO v_count FROM exam_questions WHERE curriculum_id = v_curriculum_id AND status != 'rejected';

  IF v_count < 1 THEN
    NEW.status := 'failed';
    NEW.last_error := 'ZERO_EXAM_QUESTIONS_MATERIALIZED: guard rejected done with 0 non-rejected questions';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_exam_pool_step_done', 'question_count', v_count
    );
    RAISE WARNING 'EXAM_POOL_GUARD: rejected done for package % — 0 questions', NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_exam_pool_step_done ON package_steps;
CREATE TRIGGER trg_guard_exam_pool_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_exam_pool_step_done();

-- ── 4. generate_oral_exam: requires oral_exam_blueprints ─────────────

CREATE OR REPLACE FUNCTION public.guard_oral_exam_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curriculum_id uuid;
  v_count integer;
BEGIN
  IF NEW.step_key <> 'generate_oral_exam' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = NEW.package_id;
  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'ORAL_EXAM_GUARD: no curriculum_id for package %', NEW.package_id;
  END IF;

  SELECT count(*) INTO v_count FROM oral_exam_blueprints WHERE curriculum_id = v_curriculum_id;

  IF v_count < 10 THEN
    NEW.status := 'failed';
    NEW.last_error := format('INSUFFICIENT_ORAL_BLUEPRINTS: %s/10 — guard rejected done', v_count);
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_oral_exam_step_done', 'blueprint_count', v_count
    );
    RAISE WARNING 'ORAL_EXAM_GUARD: rejected done for package % — %/10 blueprints', NEW.package_id, v_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_oral_exam_step_done ON package_steps;
CREATE TRIGGER trg_guard_oral_exam_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_oral_exam_step_done();

-- ── 5. generate_lesson_minichecks: requires minicheck_questions ──────

CREATE OR REPLACE FUNCTION public.guard_minichecks_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curriculum_id uuid;
  v_count integer;
BEGIN
  IF NEW.step_key <> 'generate_lesson_minichecks' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = NEW.package_id;
  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'MINICHECK_GUARD: no curriculum_id for package %', NEW.package_id;
  END IF;

  SELECT count(*) INTO v_count FROM minicheck_questions WHERE curriculum_id = v_curriculum_id;

  IF v_count < 1 THEN
    NEW.status := 'failed';
    NEW.last_error := 'ZERO_MINICHECKS_MATERIALIZED: guard rejected done with 0 minicheck questions';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_minichecks_step_done', 'minicheck_count', v_count
    );
    RAISE WARNING 'MINICHECK_GUARD: rejected done for package % — 0 minichecks', NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_minichecks_step_done ON package_steps;
CREATE TRIGGER trg_guard_minichecks_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_minichecks_step_done();

-- ── 6. generate_handbook: requires handbook_sections ─────────────────

CREATE OR REPLACE FUNCTION public.guard_handbook_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curriculum_id uuid;
  v_count integer;
BEGIN
  IF NEW.step_key <> 'generate_handbook' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = NEW.package_id;
  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'HANDBOOK_GUARD: no curriculum_id for package %', NEW.package_id;
  END IF;

  SELECT count(*) INTO v_count
  FROM handbook_sections hs
  JOIN handbook_chapters hc ON hs.chapter_id = hc.id
  WHERE hc.curriculum_id = v_curriculum_id;

  IF v_count < 1 THEN
    NEW.status := 'failed';
    NEW.last_error := 'ZERO_HANDBOOK_SECTIONS_MATERIALIZED: guard rejected done with 0 sections';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_handbook_step_done', 'section_count', v_count
    );
    RAISE WARNING 'HANDBOOK_GUARD: rejected done for package % — 0 handbook sections', NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_handbook_step_done ON package_steps;
CREATE TRIGGER trg_guard_handbook_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_handbook_step_done();

-- ── 7. build_ai_tutor_index: requires ai_tutor_context_index ─────────

CREATE OR REPLACE FUNCTION public.guard_tutor_index_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.step_key <> 'build_ai_tutor_index' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count FROM ai_tutor_context_index WHERE package_id = NEW.package_id;

  IF v_count < 1 THEN
    NEW.status := 'failed';
    NEW.last_error := 'ZERO_TUTOR_INDEX_MATERIALIZED: guard rejected done with 0 index entries';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_tutor_index_step_done', 'index_count', v_count
    );
    RAISE WARNING 'TUTOR_INDEX_GUARD: rejected done for package % — 0 tutor index entries', NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tutor_index_step_done ON package_steps;
CREATE TRIGGER trg_guard_tutor_index_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_tutor_index_step_done();

-- ── 8. run_integrity_check: requires integrity_report ────────────────

CREATE OR REPLACE FUNCTION public.guard_integrity_step_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_report jsonb;
  v_version integer;
BEGIN
  IF NEW.step_key <> 'run_integrity_check' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;

  SELECT integrity_report, integrity_report_version INTO v_report, v_version
  FROM course_packages WHERE id = NEW.package_id;

  IF v_report IS NULL OR v_version IS NULL THEN
    NEW.status := 'failed';
    NEW.last_error := 'INTEGRITY_REPORT_MISSING: guard rejected done — no report materialized';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard_rejected_at', now()::text, 'guard_name', 'guard_integrity_step_done',
      'has_report', v_report IS NOT NULL, 'has_version', v_version IS NOT NULL
    );
    RAISE WARNING 'INTEGRITY_GUARD: rejected done for package % — missing report', NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_integrity_step_done ON package_steps;
CREATE TRIGGER trg_guard_integrity_step_done
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_integrity_step_done();
