
CREATE OR REPLACE FUNCTION public.fn_guard_redundant_seeding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pkg_id uuid;
  _curriculum_id uuid;
  _bp_count int;
  _step_key text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  
  IF NEW.job_type NOT IN ('package_auto_seed_exam_blueprints', 'package_generate_blueprint_variants') THEN
    RETURN NEW;
  END IF;

  _pkg_id := (NEW.payload->>'package_id')::uuid;
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.curriculum_id INTO _curriculum_id
  FROM course_packages cp WHERE cp.id = _pkg_id;
  
  IF _curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _bp_count
  FROM question_blueprints qb
  WHERE qb.curriculum_id = _curriculum_id
    AND qb.status IN ('approved', 'review');

  IF _bp_count >= 10 THEN
    -- Derive step_key from job_type
    _step_key := substring(NEW.job_type FROM 9); -- strip 'package_'

    -- AUTO-COMPLETE the step to prevent deadlock
    UPDATE package_steps
    SET status = 'done',
        updated_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'done_reason', 'redundant_seeding_guard',
          'existing_blueprints', _bp_count,
          'auto_completed_at', now()
        )
    WHERE package_id = _pkg_id
      AND step_key = _step_key
      AND status IN ('queued', 'pending', 'running');

    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_blocked',
      jsonb_build_object(
        'package_id', _pkg_id,
        'curriculum_id', _curriculum_id,
        'job_type', NEW.job_type,
        'existing_blueprints', _bp_count,
        'step_auto_completed', _step_key
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;
