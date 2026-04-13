
-- Fix ambiguous column reference in fn_prebuild_auto_seed_exam_blueprints
DROP FUNCTION IF EXISTS public.fn_prebuild_auto_seed_exam_blueprints(uuid);
CREATE OR REPLACE FUNCTION public.fn_prebuild_auto_seed_exam_blueprints(p_package_id uuid)
 RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid;
  v_approved_count int;
  v_total_count int;
  v_now timestamptz := now();
  v_step_status text;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id
  FROM course_packages WHERE id = p_package_id;
  
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_seed_exam_blueprints';

  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_approved_count
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  SELECT COUNT(*) INTO v_total_count
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id;

  IF v_approved_count < 10 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'INSUFFICIENT_BLUEPRINTS'::text,
      jsonb_build_object('approved', v_approved_count, 'total', v_total_count, 'required', 10);
    RETURN;
  END IF;

  UPDATE package_steps
  SET status = 'done',
      started_at = COALESCE(started_at, v_now),
      completed_at = v_now,
      updated_at = v_now,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_auto_seed_exam_blueprints',
        'adopted', true,
        'adopted_from_ssot', true,
        'approved_blueprints', v_approved_count,
        'total_blueprints', v_total_count,
        'checked_at', v_now::text
      )
  WHERE package_id = p_package_id AND step_key = 'auto_seed_exam_blueprints'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted', true, 'approved_blueprints', v_approved_count, 'total_blueprints', v_total_count);
END;
$function$;

-- Fix ambiguous column reference in fn_prebuild_generate_blueprint_variants
DROP FUNCTION IF EXISTS public.fn_prebuild_generate_blueprint_variants(uuid);
CREATE OR REPLACE FUNCTION public.fn_prebuild_generate_blueprint_variants(p_package_id uuid)
 RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid;
  v_total_blueprints int;
  v_blueprints_with_variants int;
  v_total_variants int;
  v_coverage_pct numeric;
  v_now timestamptz := now();
  v_step_status text;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id
  FROM course_packages WHERE id = p_package_id;
  
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'generate_blueprint_variants';

  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_total_blueprints
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  IF v_total_blueprints = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_APPROVED_BLUEPRINTS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT qb.id) INTO v_blueprints_with_variants
  FROM question_blueprints qb
  JOIN exam_question_variants eqv ON eqv.blueprint_id = qb.id
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  SELECT COUNT(*) INTO v_total_variants
  FROM exam_question_variants eqv
  JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  v_coverage_pct := ROUND((v_blueprints_with_variants::numeric / v_total_blueprints) * 100, 1);

  IF v_coverage_pct < 80 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'INSUFFICIENT_VARIANT_COVERAGE'::text,
      jsonb_build_object('total_blueprints', v_total_blueprints, 'blueprints_with_variants', v_blueprints_with_variants, 'coverage_pct', v_coverage_pct, 'total_variants', v_total_variants, 'required_pct', 80);
    RETURN;
  END IF;

  UPDATE package_steps
  SET status = 'done',
      started_at = COALESCE(started_at, v_now),
      completed_at = v_now,
      updated_at = v_now,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_generate_blueprint_variants',
        'adopted', true,
        'adopted_from_ssot', true,
        'total_blueprints', v_total_blueprints,
        'blueprints_with_variants', v_blueprints_with_variants,
        'coverage_pct', v_coverage_pct,
        'total_variants', v_total_variants,
        'checked_at', v_now::text
      )
  WHERE package_id = p_package_id AND step_key = 'generate_blueprint_variants'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted', true, 'total_blueprints', v_total_blueprints, 'blueprints_with_variants', v_blueprints_with_variants, 'coverage_pct', v_coverage_pct, 'total_variants', v_total_variants);
END;
$function$;

-- Fix ambiguous column reference in fn_prebuild_validate_blueprint_variants
DROP FUNCTION IF EXISTS public.fn_prebuild_validate_blueprint_variants(uuid);
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_blueprint_variants(p_package_id uuid)
 RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid;
  v_total_variants int;
  v_review_or_better int;
  v_total_blueprints int;
  v_now timestamptz := now();
  v_step_status text;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id
  FROM course_packages WHERE id = p_package_id;
  
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprint_variants';

  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_total_blueprints
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  SELECT COUNT(*) INTO v_total_variants
  FROM exam_question_variants eqv
  JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  SELECT COUNT(*) INTO v_review_or_better
  FROM exam_question_variants eqv
  JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
  WHERE qb.curriculum_id = v_curriculum_id 
    AND qb.status = 'approved'
    AND eqv.status IN ('review', 'approved', 'promoted');

  IF v_total_variants < 10 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'INSUFFICIENT_VARIANTS'::text,
      jsonb_build_object('total_variants', v_total_variants, 'required', 10);
    RETURN;
  END IF;

  IF v_review_or_better < (v_total_variants * 0.5) THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'LOW_REVIEW_RATIO'::text,
      jsonb_build_object('total', v_total_variants, 'review_or_better', v_review_or_better);
    RETURN;
  END IF;

  UPDATE package_steps
  SET status = 'done',
      started_at = COALESCE(started_at, v_now),
      completed_at = v_now,
      updated_at = v_now,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_validate_blueprint_variants',
        'adopted', true,
        'adopted_from_ssot', true,
        'total_variants', v_total_variants,
        'review_or_better', v_review_or_better,
        'total_blueprints', v_total_blueprints,
        'checked_at', v_now::text
      )
  WHERE package_id = p_package_id AND step_key = 'validate_blueprint_variants'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted', true, 'total_variants', v_total_variants, 'review_or_better', v_review_or_better, 'total_blueprints', v_total_blueprints);
END;
$function$;
