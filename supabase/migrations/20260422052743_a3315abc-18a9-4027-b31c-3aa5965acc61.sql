CREATE OR REPLACE FUNCTION public.fn_guard_redundant_seeding()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  _pkg_id          uuid;
  _curriculum_id   uuid;
  _step_key        text;
  _bp_count        int := 0;
  _variant_count   int := 0;
  _required_min    int := 10;
  _is_truth        boolean := false;
  _reason          text;
  _is_targeted_fill boolean := false;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.job_type NOT IN ('package_auto_seed_exam_blueprints','package_generate_blueprint_variants') THEN
    RETURN NEW;
  END IF;

  -- ── Self-Heal Loop v1: bypass for scoped targeted_blueprint_fill ──────────
  -- These jobs heal specific competencies, not the whole curriculum,
  -- and must not be classified as "redundant" by the global coverage check.
  _is_targeted_fill := (
    COALESCE(NEW.payload->>'mode','') = 'targeted_blueprint_fill'
    OR COALESCE((NEW.payload->>'continuation_of_targeted_fill')::boolean, false) = true
  );

  IF _is_targeted_fill THEN
    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_targeted_bypass',
      jsonb_build_object(
        'package_id', (NEW.payload->>'package_id')::uuid,
        'job_type', NEW.job_type,
        'mode', NEW.payload->>'mode',
        'targets', jsonb_array_length(COALESCE(NEW.payload->'target_competency_ids','[]'::jsonb))
      )
    );
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

  _step_key := substring(NEW.job_type FROM 9);

  IF NEW.job_type = 'package_auto_seed_exam_blueprints' THEN
    SELECT count(*) INTO _bp_count
    FROM question_blueprints qb
    WHERE qb.curriculum_id = _curriculum_id
      AND qb.status IN ('approved','review');

    _is_truth := (_bp_count >= _required_min);
    _reason   := CASE WHEN _is_truth
                   THEN 'REDUNDANT_BLUEPRINTS_PRESENT'
                   ELSE 'BLUEPRINTS_INSUFFICIENT' END;

  ELSIF NEW.job_type = 'package_generate_blueprint_variants' THEN
    SELECT count(*) INTO _variant_count
    FROM exam_question_variants v
    JOIN question_blueprints qb ON qb.id = v.blueprint_id
    WHERE qb.curriculum_id = _curriculum_id;

    SELECT count(*) INTO _bp_count
    FROM question_blueprints qb
    WHERE qb.curriculum_id = _curriculum_id
      AND qb.status IN ('approved','review');

    _is_truth := (
      _variant_count >= 10
      AND _bp_count > 0
      AND (
        SELECT count(DISTINCT v.blueprint_id)::numeric / NULLIF(_bp_count,0)
        FROM exam_question_variants v
        JOIN question_blueprints qb ON qb.id = v.blueprint_id
        WHERE qb.curriculum_id = _curriculum_id
      ) >= 0.8
    );
    _reason := CASE WHEN _is_truth
                 THEN 'REDUNDANT_VARIANTS_PRESENT'
                 ELSE 'VARIANTS_INSUFFICIENT' END;
  END IF;

  IF _is_truth THEN
    UPDATE package_steps ps
    SET meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
          'redundant_detected', true,
          'redundant_reason',  _reason,
          'redundant_job_type', NEW.job_type,
          'redundant_blueprints', _bp_count,
          'redundant_variants',   _variant_count,
          'redundant_detected_at', now()
        ),
        updated_at = now()
    WHERE ps.package_id = _pkg_id
      AND ps.step_key::text = _step_key
      AND ps.status IN ('queued','enqueued','running','pending_enqueue');

    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_marked',
      jsonb_build_object(
        'package_id', _pkg_id,
        'curriculum_id', _curriculum_id,
        'job_type', NEW.job_type,
        'step_key', _step_key,
        'reason', _reason,
        'blueprints', _bp_count,
        'variants', _variant_count
      )
    );
    RETURN NULL;
  END IF;

  PERFORM public.fn_log_guardrail_event(
    'redundant_seeding_passthrough',
    jsonb_build_object(
      'package_id', _pkg_id,
      'curriculum_id', _curriculum_id,
      'job_type', NEW.job_type,
      'step_key', _step_key,
      'reason', _reason,
      'blueprints', _bp_count,
      'variants', _variant_count
    )
  );
  RETURN NEW;
END;
$function$;