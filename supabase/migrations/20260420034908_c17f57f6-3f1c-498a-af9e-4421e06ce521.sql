DROP FUNCTION IF EXISTS public.fn_prebuild_auto_seed_exam_blueprints(uuid);
DROP FUNCTION IF EXISTS public.fn_prebuild_validate_blueprints(uuid);
DROP FUNCTION IF EXISTS public.fn_prebuild_generate_blueprint_variants(uuid);
DROP FUNCTION IF EXISTS public.fn_prebuild_promote_blueprint_variants(uuid);

CREATE FUNCTION public.fn_prebuild_auto_seed_exam_blueprints(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid; v_approved_count int; v_total_count int;
  v_now timestamptz := now(); v_step_status text;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT ps.status INTO v_step_status FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_seed_exam_blueprints';
  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT COUNT(*) INTO v_approved_count FROM question_blueprints qb
    WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';
  SELECT COUNT(*) INTO v_total_count FROM question_blueprints qb
    WHERE qb.curriculum_id = v_curriculum_id;
  IF v_approved_count < 10 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'INSUFFICIENT_BLUEPRINTS'::text,
      jsonb_build_object('approved', v_approved_count, 'total', v_total_count, 'required', 10);
    RETURN;
  END IF;
  UPDATE package_steps ps
  SET status = 'done', started_at = COALESCE(ps.started_at, v_now),
      completed_at = v_now, updated_at = v_now,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true, 'prebuild_fn', 'fn_prebuild_auto_seed_exam_blueprints',
        'adopted', true, 'adopted_from_ssot', true,
        'approved_blueprints', v_approved_count, 'total_blueprints', v_total_count,
        'checked_at', v_now::text)
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_seed_exam_blueprints' AND ps.status != 'done';
  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted', true, 'approved_blueprints', v_approved_count, 'total_blueprints', v_total_count);
END;
$function$;

CREATE FUNCTION public.fn_prebuild_validate_blueprints(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid; v_total int; v_terminal int;
  v_now timestamptz := now(); v_step_status text;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT ps.status INTO v_step_status FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprints';
  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status IN ('approved','rejected','review','promoted'))
    INTO v_total, v_terminal
  FROM question_blueprints WHERE curriculum_id = v_curriculum_id;
  IF v_total = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_BLUEPRINTS'::text, '{}'::jsonb; RETURN;
  END IF;
  IF v_terminal < v_total THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NON_TERMINAL_BLUEPRINTS'::text,
      jsonb_build_object('total', v_total, 'terminal', v_terminal); RETURN;
  END IF;
  UPDATE package_steps ps
  SET status = 'done', started_at = COALESCE(ps.started_at, v_now),
      completed_at = v_now, updated_at = v_now,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true, 'prebuild_fn', 'fn_prebuild_validate_blueprints',
        'adopted', true, 'adopted_from_ssot', true,
        'total_blueprints', v_total, 'terminal_blueprints', v_terminal,
        'checked_at', v_now::text)
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprints' AND ps.status != 'done';
  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted', true, 'total_blueprints', v_total);
END;
$function$;

CREATE FUNCTION public.fn_prebuild_generate_blueprint_variants(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid; v_total_bp int; v_with_variants int;
  v_now timestamptz := now(); v_step_status text; v_pct numeric;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT ps.status INTO v_step_status FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'generate_blueprint_variants';
  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT COUNT(DISTINCT qb.id) INTO v_total_bp FROM question_blueprints qb
   WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';
  SELECT COUNT(DISTINCT qb.id) INTO v_with_variants FROM question_blueprints qb
   JOIN exam_question_variants eqv ON eqv.blueprint_id = qb.id
   WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';
  IF v_total_bp = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_APPROVED_BLUEPRINTS'::text, '{}'::jsonb; RETURN;
  END IF;
  v_pct := (v_with_variants::numeric / v_total_bp::numeric) * 100;
  IF v_pct < 80 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'INSUFFICIENT_VARIANT_COVERAGE'::text,
      jsonb_build_object('total_bp', v_total_bp, 'with_variants', v_with_variants, 'pct', v_pct);
    RETURN;
  END IF;
  UPDATE package_steps ps
  SET status = 'done', started_at = COALESCE(ps.started_at, v_now),
      completed_at = v_now, updated_at = v_now,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true, 'prebuild_fn', 'fn_prebuild_generate_blueprint_variants',
        'adopted', true, 'adopted_from_ssot', true,
        'total_blueprints', v_total_bp, 'with_variants', v_with_variants,
        'coverage_pct', v_pct, 'checked_at', v_now::text)
  WHERE ps.package_id = p_package_id AND ps.step_key = 'generate_blueprint_variants' AND ps.status != 'done';
  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted', true, 'coverage_pct', v_pct);
END;
$function$;

CREATE FUNCTION public.fn_prebuild_promote_blueprint_variants(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid; v_promoted_variants int; v_exam_questions int;
  v_now timestamptz := now(); v_step_status text;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT ps.status INTO v_step_status FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants';
  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb; RETURN;
  END IF;
  SELECT COUNT(*) INTO v_promoted_variants FROM exam_question_variants eqv
   JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
   WHERE qb.curriculum_id = v_curriculum_id AND eqv.status = 'promoted';
  SELECT COUNT(*) INTO v_exam_questions FROM exam_questions eq
   WHERE eq.curriculum_id = v_curriculum_id;
  IF v_exam_questions = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_PROMOTED_EXAM_QUESTIONS'::text,
      jsonb_build_object('promoted_variants', v_promoted_variants, 'exam_questions', 0); RETURN;
  END IF;
  UPDATE package_steps ps
  SET status = 'done', started_at = COALESCE(ps.started_at, v_now),
      completed_at = v_now, updated_at = v_now,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true, 'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
        'adopted', true, 'adopted_from_ssot', true,
        'promoted_variants', v_promoted_variants, 'exam_questions', v_exam_questions,
        'checked_at', v_now::text)
  WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants' AND ps.status != 'done';
  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted', true, 'exam_questions', v_exam_questions);
END;
$function$;