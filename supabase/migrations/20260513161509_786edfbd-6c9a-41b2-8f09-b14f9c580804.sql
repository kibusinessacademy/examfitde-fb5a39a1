-- Phase C, Bug E.1 + E.2: Make fn_guard_redundant_seeding LF-aware so that
-- targeted LF-coverage repair (BLUEPRINT_GAP / VARIANT_GAP) for an LF with
-- 0 approved blueprints (or 0 usable variants) is no longer silently dropped
-- because the *package* as a whole already has blueprints / variants in OTHER LFs.
--
-- Contract:
--   * If payload->>'learning_field_filter' (uuid) is set, truth checks scope to that LF only.
--   * Else legacy package-wide truth checks (unchanged thresholds).
--   * Audit-mirror to auto_heal_log uses differentiated reasons:
--       REDUNDANT_PACKAGE_BLUEPRINTS_PRESENT
--       REDUNDANT_LF_BLUEPRINTS_PRESENT
--       REDUNDANT_PACKAGE_VARIANTS_PRESENT
--       REDUNDANT_LF_VARIANTS_PRESENT
--   * No package_steps mutation (existing rule preserved).
--   * Mirror INSERT failure must never block SSOT (BEGIN/EXCEPTION wrapper preserved).

CREATE OR REPLACE FUNCTION public.fn_guard_redundant_seeding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pkg_id uuid;
  _curriculum_id uuid;
  _step_key text;
  _bp_count int := 0;
  _variant_count int := 0;
  _required_min int := 10;
  _coverage numeric := 0;
  _is_truth boolean := false;
  _reason text;
  _is_targeted_fill boolean := false;
  _is_wave_heal_lf boolean := false;
  _target_lfs_len int := 0;
  _origin text;
  _lf_filter uuid;
  _scope text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.job_type NOT IN ('package_auto_seed_exam_blueprints','package_generate_blueprint_variants') THEN
    RETURN NEW;
  END IF;

  _is_targeted_fill := (
    COALESCE(NEW.payload->>'mode','') = 'targeted_blueprint_fill'
    OR COALESCE((NEW.payload->>'continuation_of_targeted_fill')::boolean, false) = true
  );

  IF _is_targeted_fill THEN
    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_targeted_bypass',
      jsonb_build_object(
        'package_id', NULLIF(NEW.payload->>'package_id','')::uuid,
        'job_type', NEW.job_type,
        'mode', NEW.payload->>'mode',
        'targets', jsonb_array_length(COALESCE(NEW.payload->'target_competency_ids','[]'::jsonb))
      )
    );
    RETURN NEW;
  END IF;

  _origin := NEW.payload->>'_origin';
  IF NEW.job_type = 'package_auto_seed_exam_blueprints'
     AND _origin = 'wave_heal_lf_coverage'
     AND jsonb_typeof(NEW.payload->'target_lfs') = 'array' THEN
    _target_lfs_len := jsonb_array_length(NEW.payload->'target_lfs');
    IF _target_lfs_len > 0 THEN
      _is_wave_heal_lf := true;
      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'redundant_seeding_wave_heal_lf_bypass',
        'fn_guard_redundant_seeding',
        'package',
        COALESCE(NEW.package_id::text, NEW.payload->>'package_id', 'unknown'),
        'success',
        'Narrow bypass: wave_heal_lf_coverage with non-empty target_lfs',
        jsonb_build_object(
          'job_type', NEW.job_type,
          'package_id', NEW.package_id,
          'origin', _origin,
          'target_lfs', NEW.payload->'target_lfs',
          'target_lfs_count', _target_lfs_len,
          'mode', NEW.payload->>'mode',
          'bronze_lock_override', COALESCE((NEW.payload->>'bronze_lock_override')::boolean, false)
        )
      );
      RETURN NEW;
    END IF;
  END IF;

  _pkg_id := COALESCE(NEW.package_id, NULLIF(NEW.payload->>'package_id','')::uuid);
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.curriculum_id INTO _curriculum_id
  FROM public.course_packages cp
  WHERE cp.id = _pkg_id;

  IF _curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  _step_key := substring(NEW.job_type FROM 9);

  -- LF-scope: phase-C router fans out 1 child per learning_field_filter.
  _lf_filter := NULLIF(NEW.payload->>'learning_field_filter','')::uuid;
  _scope := CASE WHEN _lf_filter IS NULL THEN 'package' ELSE 'lf' END;

  IF NEW.job_type = 'package_auto_seed_exam_blueprints' THEN
    IF _lf_filter IS NULL THEN
      SELECT count(*) INTO _bp_count
      FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id
        AND qb.status IN ('approved','review');
    ELSE
      SELECT count(*) INTO _bp_count
      FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id
        AND qb.learning_field_id = _lf_filter
        AND qb.status IN ('approved','review');
    END IF;
    _is_truth := (_bp_count >= _required_min);
    _reason := CASE
      WHEN _is_truth AND _scope='lf' THEN 'REDUNDANT_LF_BLUEPRINTS_PRESENT'
      WHEN _is_truth THEN 'REDUNDANT_PACKAGE_BLUEPRINTS_PRESENT'
      ELSE 'BLUEPRINTS_INSUFFICIENT'
    END;

  ELSIF NEW.job_type = 'package_generate_blueprint_variants' THEN
    IF _lf_filter IS NULL THEN
      SELECT count(*) INTO _variant_count
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id;
      SELECT count(*) INTO _bp_count
      FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id
        AND qb.status IN ('approved','review');
      SELECT COALESCE(count(DISTINCT v.blueprint_id)::numeric / NULLIF(_bp_count, 0), 0)
      INTO _coverage
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id;
    ELSE
      SELECT count(*) INTO _variant_count
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id
        AND qb.learning_field_id = _lf_filter;
      SELECT count(*) INTO _bp_count
      FROM public.question_blueprints qb
      WHERE qb.curriculum_id = _curriculum_id
        AND qb.learning_field_id = _lf_filter
        AND qb.status IN ('approved','review');
      SELECT COALESCE(count(DISTINCT v.blueprint_id)::numeric / NULLIF(_bp_count, 0), 0)
      INTO _coverage
      FROM public.exam_question_variants v
      JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
      WHERE qb.curriculum_id = _curriculum_id
        AND qb.learning_field_id = _lf_filter;
    END IF;
    _is_truth := (_variant_count >= 10 AND _bp_count > 0 AND _coverage >= 0.8);
    _reason := CASE
      WHEN _is_truth AND _scope='lf' THEN 'REDUNDANT_LF_VARIANTS_PRESENT'
      WHEN _is_truth THEN 'REDUNDANT_PACKAGE_VARIANTS_PRESENT'
      ELSE 'VARIANTS_INSUFFICIENT'
    END;
  END IF;

  IF _is_truth THEN
    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_suppressed_no_step_mutation',
      jsonb_build_object(
        'package_id', _pkg_id,
        'curriculum_id', _curriculum_id,
        'job_type', NEW.job_type,
        'step_key', _step_key,
        'reason', _reason,
        'scope', _scope,
        'learning_field_id', _lf_filter,
        'blueprints', _bp_count,
        'variants', _variant_count,
        'coverage', _coverage,
        'root_cause_fix', 'no_package_steps_update_from_job_queue_trigger'
      )
    );

    -- Mirror to auto_heal_log (single-pane-of-glass). SSOT bleibt ops_guardrail_events.
    BEGIN
      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'job_queue_insert_suppressed_redundant_seeding',
        'fn_guard_redundant_seeding',
        'package',
        _pkg_id::text,
        'skipped',
        format('Suppressed %s (%s scope%s): %s (bp=%s, variants=%s, coverage=%s)',
               NEW.job_type, _scope,
               CASE WHEN _lf_filter IS NULL THEN '' ELSE ', lf='||_lf_filter::text END,
               _reason, _bp_count, _variant_count, round(_coverage, 3)),
        jsonb_build_object(
          'reason', _reason,
          'scope', _scope,
          'learning_field_id', _lf_filter,
          'job_type', NEW.job_type,
          'step_key', _step_key,
          'package_id', _pkg_id,
          'curriculum_id', _curriculum_id,
          'blueprints', _bp_count,
          'variants', _variant_count,
          'coverage', _coverage,
          'origin', _origin,
          'ssot', 'ops_guardrail_events',
          'mirror', true
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Mirror darf SSOT nie blockieren
      NULL;
    END;

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
      'scope', _scope,
      'learning_field_id', _lf_filter,
      'blueprints', _bp_count,
      'variants', _variant_count,
      'coverage', _coverage
    )
  );
  RETURN NEW;
END;
$function$;

-- Audit
INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, result_status, result_detail, metadata)
VALUES (
  'guard_redundant_seeding_lf_aware_v1_deployed',
  'migration',
  'system',
  'success',
  'fn_guard_redundant_seeding now scopes truth to learning_field_filter when present; both auto_seed_exam_blueprints and generate_blueprint_variants paths covered.',
  jsonb_build_object(
    'reasons', jsonb_build_array(
      'REDUNDANT_PACKAGE_BLUEPRINTS_PRESENT',
      'REDUNDANT_LF_BLUEPRINTS_PRESENT',
      'REDUNDANT_PACKAGE_VARIANTS_PRESENT',
      'REDUNDANT_LF_VARIANTS_PRESENT'
    ),
    'phase', 'C',
    'bugs_fixed', jsonb_build_array('E.1','E.2')
  )
);