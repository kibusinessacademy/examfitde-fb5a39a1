CREATE OR REPLACE FUNCTION public.fn_guard_validate_exam_pool_causality()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_package_id uuid;
  v_curriculum_id uuid;
  v_seed_status text;
  v_validate_bp_status text;
  v_blueprint_count integer;
  v_reason text := NULL;
  v_missing_upstream text := NULL;
BEGIN
  IF NEW.job_type <> 'package_validate_exam_pool' THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('queued', 'enqueued', 'processing', 'running') THEN
    RETURN NEW;
  END IF;

  v_package_id := (NEW.payload->>'package_id')::uuid;
  IF v_package_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM public.course_packages cp
  WHERE cp.id = v_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_seed_status
  FROM public.package_steps
  WHERE package_id = v_package_id AND step_key = 'auto_seed_exam_blueprints'
  LIMIT 1;

  SELECT status INTO v_validate_bp_status
  FROM public.package_steps
  WHERE package_id = v_package_id AND step_key = 'validate_blueprints'
  LIMIT 1;

  -- P0 FIX: cast enum to text BEFORE comparing to '' so empty-string never reaches enum
  SELECT COUNT(*) INTO v_blueprint_count
  FROM public.question_blueprints
  WHERE curriculum_id = v_curriculum_id
    AND (status IS NULL OR status::text <> 'deprecated');

  IF v_seed_status IS NOT NULL AND v_seed_status NOT IN ('done', 'skipped') THEN
    v_reason := 'UPSTREAM_CAUSALITY_NOT_SATISFIED_BLUEPRINTS';
    v_missing_upstream := 'auto_seed_exam_blueprints=' || v_seed_status;
  ELSIF v_blueprint_count = 0 THEN
    v_reason := 'UPSTREAM_CAUSALITY_NOT_SATISFIED_BLUEPRINTS';
    v_missing_upstream := 'no_blueprints_in_curriculum';
  ELSIF v_validate_bp_status IS NOT NULL AND v_validate_bp_status NOT IN ('done', 'skipped') THEN
    v_reason := 'UPSTREAM_CAUSALITY_NOT_SATISFIED_BLUEPRINTS';
    v_missing_upstream := 'validate_blueprints=' || v_validate_bp_status;
  END IF;

  IF v_reason IS NOT NULL THEN
    NEW.status := 'cancelled';
    NEW.last_error := v_reason || ': ' || v_missing_upstream;
    NEW.completed_at := COALESCE(NEW.completed_at, now());

    INSERT INTO public.admin_actions (action, scope, payload, affected_ids, created_at)
    VALUES (
      'validate_exam_pool_causality_guard_blocked',
      'pipeline.dag.causality',
      jsonb_build_object(
        'job_id', NEW.id,
        'package_id', v_package_id,
        'curriculum_id', v_curriculum_id,
        'reason', v_reason,
        'missing_upstream', v_missing_upstream,
        'blueprint_count', v_blueprint_count,
        'seed_status', v_seed_status,
        'validate_bp_status', v_validate_bp_status
      ),
      ARRAY[NEW.id::text, v_package_id::text],
      now()
    );
  END IF;

  RETURN NEW;
END;
$function$;