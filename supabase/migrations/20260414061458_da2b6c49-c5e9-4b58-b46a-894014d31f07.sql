-- Fix ambiguous column reference in fn_prebuild_validate_blueprint_variants
-- The PL/pgSQL return variable "meta" collides with package_steps.meta
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_blueprint_variants(p_package_id uuid)
 RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_current_status text;
  v_total_variants  bigint;
  v_review_or_better bigint;
  v_total_blueprints bigint;
  v_now             text := now()::text;
BEGIN
  -- 1) Check current step status
  SELECT ps.status INTO v_current_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprint_variants';

  IF v_current_status IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb;
    RETURN;
  END IF;

  IF v_current_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 2) Check prerequisite: generate_blueprint_variants must be done
  IF NOT EXISTS (
    SELECT 1 FROM package_steps ps2
    WHERE ps2.package_id = p_package_id AND ps2.step_key = 'generate_blueprint_variants' AND ps2.status = 'done'
  ) THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'PREREQ_NOT_MET'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 3) Count variants and blueprints
  SELECT COUNT(*) INTO v_total_variants
  FROM exam_question_variants eqv
  JOIN exam_blueprints eb ON eb.id = eqv.blueprint_id
  WHERE eb.package_id = p_package_id;

  SELECT COUNT(*) INTO v_review_or_better
  FROM exam_question_variants eqv
  JOIN exam_blueprints eb ON eb.id = eqv.blueprint_id
  WHERE eb.package_id = p_package_id AND eqv.status IN ('review', 'approved', 'promoted');

  SELECT COUNT(*) INTO v_total_blueprints
  FROM exam_blueprints eb
  WHERE eb.package_id = p_package_id AND eb.status = 'approved';

  -- 4) If we have sufficient variants, adopt
  IF v_total_variants >= 6 AND v_review_or_better >= 1 THEN
    UPDATE package_steps ps_upd
    SET status = 'done',
        started_at = COALESCE(ps_upd.started_at, v_now::timestamptz),
        completed_at = v_now::timestamptz,
        updated_at = v_now::timestamptz,
        meta = COALESCE(ps_upd.meta, '{}'::jsonb) || jsonb_build_object(
          'prebuild', true,
          'prebuild_fn', 'fn_prebuild_validate_blueprint_variants',
          'adopted', true,
          'adopted_from_ssot', true,
          'total_variants', v_total_variants,
          'review_or_better', v_review_or_better,
          'total_blueprints', v_total_blueprints,
          'checked_at', v_now
        )
    WHERE ps_upd.package_id = p_package_id AND ps_upd.step_key = 'validate_blueprint_variants'
      AND ps_upd.status != 'done';

    RETURN QUERY SELECT 'done'::text, true, 'ADOPTED_FROM_SSOT'::text, 
      jsonb_build_object(
        'total_variants', v_total_variants,
        'review_or_better', v_review_or_better,
        'total_blueprints', v_total_blueprints
      );
    RETURN;
  END IF;

  -- 5) Not enough data to adopt
  RETURN QUERY SELECT 'pending'::text, false, 'INSUFFICIENT_VARIANTS'::text,
    jsonb_build_object(
      'total_variants', v_total_variants,
      'review_or_better', v_review_or_better,
      'total_blueprints', v_total_blueprints
    );
END;
$function$;