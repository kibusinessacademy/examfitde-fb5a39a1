-- Fix 1: fn_guard_oral_exam_completeness — resolve curriculum from package first
CREATE OR REPLACE FUNCTION public.fn_guard_oral_exam_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _total_comps int;
  _covered_comps int;
  _cert_id uuid;
  _cur_id uuid;
  _pkg_curriculum_id uuid;
BEGIN
  IF NEW.step_key != 'generate_oral_exam' THEN
    RETURN NEW;
  END IF;
  IF NEW.status != 'done' OR OLD.status = 'done' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.exception_approved, false) THEN
    RETURN NEW;
  END IF;

  -- Prefer direct package-level curriculum_id
  SELECT cp.curriculum_id, cp.certification_id
  INTO _pkg_curriculum_id, _cert_id
  FROM course_packages cp
  WHERE cp.id = NEW.package_id;

  _cur_id := _pkg_curriculum_id;

  -- Fallback: resolve via certification
  IF _cur_id IS NULL AND _cert_id IS NOT NULL THEN
    SELECT c.id INTO _cur_id
    FROM curricula c
    WHERE c.certification_id = _cert_id
    LIMIT 1;
  END IF;

  IF _cur_id IS NULL THEN
    RETURN NEW; -- no curriculum, skip guard
  END IF;

  SELECT COUNT(*) INTO _total_comps
  FROM competencies
  WHERE learning_field_id IN (SELECT id FROM learning_fields WHERE curriculum_id = _cur_id);

  SELECT COUNT(DISTINCT competency_id) INTO _covered_comps
  FROM oral_exam_blueprints
  WHERE curriculum_id = _cur_id AND competency_id IS NOT NULL;

  IF _total_comps > 0 AND _covered_comps < _total_comps THEN
    RAISE EXCEPTION 'ORAL_EXAM_INCOMPLETE: only %/% competencies covered by oral exam blueprints',
      _covered_comps, _total_comps;
  END IF;

  RETURN NEW;
END;
$function$;

-- Fix 2: fn_exam_question_auto_fill — prefer package-linked curriculum when available
CREATE OR REPLACE FUNCTION public.fn_exam_question_auto_fill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_cert_id uuid;
  v_comp_id uuid;
  v_lf_id uuid;
  v_bp_ctx text;
  v_pkg_curriculum_id uuid;
BEGIN
  -- 1. Derive certification_id from curriculum_id
  IF NEW.certification_id IS NULL AND NEW.curriculum_id IS NOT NULL THEN
    SELECT certification_id INTO v_cert_id
    FROM curricula WHERE id = NEW.curriculum_id;
    IF v_cert_id IS NOT NULL THEN
      NEW.certification_id := v_cert_id;
    END IF;
  END IF;

  -- 2. Derive competency_id and learning_field_id from blueprint
  IF NEW.blueprint_id IS NOT NULL THEN
    IF NEW.competency_id IS NULL OR NEW.learning_field_id IS NULL THEN
      SELECT competency_id, learning_field_id
      INTO v_comp_id, v_lf_id
      FROM question_blueprints WHERE id = NEW.blueprint_id;
      IF NEW.competency_id IS NULL AND v_comp_id IS NOT NULL THEN
        NEW.competency_id := v_comp_id;
      END IF;
      IF NEW.learning_field_id IS NULL AND v_lf_id IS NOT NULL THEN
        NEW.learning_field_id := v_lf_id;
      END IF;
    END IF;
  END IF;

  -- 3. Derive learning_field_id from competency_id
  IF NEW.learning_field_id IS NULL AND NEW.competency_id IS NOT NULL THEN
    SELECT learning_field_id INTO v_lf_id
    FROM competencies WHERE id = NEW.competency_id;
    IF v_lf_id IS NOT NULL THEN
      NEW.learning_field_id := v_lf_id;
    END IF;
  END IF;

  -- 4. Derive curriculum_id: prefer package-linked, fallback to certification lookup
  IF NEW.curriculum_id IS NULL THEN
    IF NEW.package_id IS NOT NULL THEN
      SELECT cp.curriculum_id INTO v_pkg_curriculum_id
      FROM course_packages cp WHERE cp.id = NEW.package_id;
      IF v_pkg_curriculum_id IS NOT NULL THEN
        NEW.curriculum_id := v_pkg_curriculum_id;
      END IF;
    END IF;

    IF NEW.curriculum_id IS NULL AND NEW.certification_id IS NOT NULL THEN
      SELECT id INTO NEW.curriculum_id
      FROM curricula WHERE certification_id = NEW.certification_id
      ORDER BY id LIMIT 1;
    END IF;
  END IF;

  -- 5. Derive exam_part
  IF NEW.exam_part IS NULL THEN
    IF NEW.blueprint_id IS NOT NULL THEN
      SELECT exam_context_type INTO v_bp_ctx
      FROM question_blueprints WHERE id = NEW.blueprint_id;
      IF v_bp_ctx IN ('case_study', 'strategic_decision', 'multi_step_case') THEN
        NEW.exam_part := 'teil_2';
      ELSE
        NEW.exam_part := 'teil_1';
      END IF;
    ELSE
      NEW.exam_part := 'teil_1';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;