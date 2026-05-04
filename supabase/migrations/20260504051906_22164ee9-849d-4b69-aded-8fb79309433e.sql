-- Root-cause fix v1: remove package_steps self-mutation from job_queue redundant guard
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

  IF NEW.job_type = 'package_auto_seed_exam_blueprints' THEN
    SELECT count(*) INTO _bp_count
    FROM public.question_blueprints qb
    WHERE qb.curriculum_id = _curriculum_id
      AND qb.status IN ('approved','review');

    _is_truth := (_bp_count >= _required_min);
    _reason := CASE WHEN _is_truth THEN 'REDUNDANT_BLUEPRINTS_PRESENT' ELSE 'BLUEPRINTS_INSUFFICIENT' END;

  ELSIF NEW.job_type = 'package_generate_blueprint_variants' THEN
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

    _is_truth := (_variant_count >= 10 AND _bp_count > 0 AND _coverage >= 0.8);
    _reason := CASE WHEN _is_truth THEN 'REDUNDANT_VARIANTS_PRESENT' ELSE 'VARIANTS_INSUFFICIENT' END;
  END IF;

  IF _is_truth THEN
    -- CRITICAL: Do not UPDATE package_steps here.
    -- This trigger fires inside job_queue INSERT, often nested from package_steps status updates.
    -- Mutating package_steps here causes SQLSTATE 27000 "tuple already modified".
    -- Dedicated heal/verifier paths finalize the step outside this trigger context.
    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_suppressed_no_step_mutation',
      jsonb_build_object(
        'package_id', _pkg_id,
        'curriculum_id', _curriculum_id,
        'job_type', NEW.job_type,
        'step_key', _step_key,
        'reason', _reason,
        'blueprints', _bp_count,
        'variants', _variant_count,
        'coverage', _coverage,
        'root_cause_fix', 'no_package_steps_update_from_job_queue_trigger'
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
      'variants', _variant_count,
      'coverage', _coverage
    )
  );
  RETURN NEW;
END;
$function$;

-- Dedicated finalizer for materialized blueprint variant steps.
CREATE OR REPLACE FUNCTION public.admin_finalize_materialized_blueprint_variant_steps(
  p_package_ids uuid[],
  p_reason text DEFAULT 'materialized_blueprint_variants_root_cause_heal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_curriculum_id uuid;
  v_bp_count int;
  v_variant_count int;
  v_coverage numeric;
  v_step record;
  v_finalized int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no package ids provided');
  END IF;

  PERFORM set_config('app.transition_source', 'admin_materialized_blueprint_variant_heal', true);

  FOREACH v_pkg_id IN ARRAY p_package_ids LOOP
    SELECT curriculum_id INTO v_curriculum_id
    FROM public.course_packages
    WHERE id = v_pkg_id;

    IF v_curriculum_id IS NULL THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg_id, 'skipped', 'no_curriculum');
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_bp_count
    FROM public.question_blueprints qb
    WHERE qb.curriculum_id = v_curriculum_id
      AND qb.status IN ('approved','review');

    SELECT count(*) INTO v_variant_count
    FROM public.exam_question_variants v
    JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
    WHERE qb.curriculum_id = v_curriculum_id;

    SELECT COALESCE(count(DISTINCT v.blueprint_id)::numeric / NULLIF(v_bp_count, 0), 0)
    INTO v_coverage
    FROM public.exam_question_variants v
    JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
    WHERE qb.curriculum_id = v_curriculum_id;

    IF NOT (v_variant_count >= 10 AND v_bp_count > 0 AND v_coverage >= 0.8) THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg_id,
        'skipped', 'variants_not_materialized',
        'blueprints', v_bp_count,
        'variants', v_variant_count,
        'coverage', v_coverage
      );
      CONTINUE;
    END IF;

    FOR v_step IN
      SELECT id, step_key, status::text AS status, last_error, meta
      FROM public.package_steps
      WHERE package_id = v_pkg_id
        AND step_key IN ('generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants')
        AND status NOT IN ('done','skipped')
      ORDER BY array_position(ARRAY['generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants'], step_key::text)
    LOOP
      UPDATE public.package_steps
      SET status = 'done'::step_status,
          started_at = COALESCE(started_at, now()),
          finished_at = now(),
          last_error = NULL,
          updated_at = now(),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'ok', true,
            'finalized_by', 'admin_finalize_materialized_blueprint_variant_steps',
            'finalization_source', 'materialized_artifact_heal',
            'finalization_reason', p_reason,
            'artifact_blueprints', v_bp_count,
            'artifact_variants', v_variant_count,
            'artifact_coverage', v_coverage,
            'previous_status', v_step.status,
            'previous_last_error', v_step.last_error,
            'finalized_at', now()
          )
      WHERE id = v_step.id
        AND status NOT IN ('done','skipped');

      UPDATE public.job_queue
      SET status = 'completed',
          completed_at = now(),
          locked_at = NULL,
          locked_by = NULL,
          last_error = NULL,
          error = NULL,
          updated_at = now(),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'completed_via', 'admin_finalize_materialized_blueprint_variant_steps',
            'finalization_reason', p_reason
          )
      WHERE package_id = v_pkg_id
        AND job_type = 'package_' || v_step.step_key::text
        AND status IN ('pending','queued','processing','running','batch_pending','failed');

      v_finalized := v_finalized + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg_id,
        'step_key', v_step.step_key,
        'action', 'finalized',
        'previous_status', v_step.status
      );
    END LOOP;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, result_status, result_detail, metadata)
  VALUES (
    'materialized_blueprint_variant_steps_finalized',
    'admin_finalize_materialized_blueprint_variant_steps',
    'system',
    CASE WHEN v_finalized > 0 THEN 'success' ELSE 'noop' END,
    format('finalized %s materialized blueprint variant step(s)', v_finalized),
    jsonb_build_object('reason', p_reason, 'results', v_results)
  );

  RETURN jsonb_build_object('ok', true, 'finalized', v_finalized, 'results', v_results, 'version', 'v1_no_blind_bypass');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_finalize_materialized_blueprint_variant_steps(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finalize_materialized_blueprint_variant_steps(uuid[], text) TO service_role, authenticated;

-- Entangled pending_enqueue healer v2: snapshot -> per-row reread -> no package status mutation -> explicit transition source.
CREATE OR REPLACE FUNCTION public.admin_unstick_pending_enqueue_steps(
  p_package_ids uuid[],
  p_reason text DEFAULT 'forensic_unstick_pending_enqueue'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_step record;
  v_deps_open int;
  v_results jsonb := '[]'::jsonb;
  v_pkg_results jsonb;
  v_promoted int;
  v_current_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no package ids provided');
  END IF;

  PERFORM set_config('app.transition_source', 'admin_unstick_pending_enqueue_steps_v2', true);

  FOREACH v_pkg_id IN ARRAY p_package_ids LOOP
    v_pkg_results := '[]'::jsonb;
    v_promoted := 0;

    FOR v_step IN
      SELECT ps.id, ps.step_key, ps.status::text AS status, ps.last_error
      FROM public.package_steps ps
      JOIN public.course_packages cp ON cp.id = ps.package_id
      WHERE ps.package_id = v_pkg_id
        AND ps.status = 'pending_enqueue'::step_status
        AND cp.status IN ('building','quality_gate_failed')
      ORDER BY ps.updated_at ASC
    LOOP
      BEGIN
        SELECT status::text INTO v_current_status
        FROM public.package_steps
        WHERE id = v_step.id
        FOR UPDATE;

        IF v_current_status IS DISTINCT FROM 'pending_enqueue' THEN
          v_pkg_results := v_pkg_results || jsonb_build_object('step_key', v_step.step_key, 'skipped', 'already_progressed', 'status', v_current_status);
          CONTINUE;
        END IF;

        SELECT count(*) INTO v_deps_open
        FROM public.step_dag_edges dag
        JOIN public.package_steps dep_ps
          ON dep_ps.package_id = v_pkg_id
         AND dep_ps.step_key = dag.depends_on
        WHERE dag.step_key = v_step.step_key
          AND dep_ps.status NOT IN ('done','skipped');

        IF v_deps_open = 0 THEN
          UPDATE public.package_steps
          SET status = 'queued'::step_status,
              attempts = 0,
              last_error = NULL,
              started_at = NULL,
              finished_at = NULL,
              last_heartbeat_at = NULL,
              updated_at = now(),
              meta = COALESCE(meta,'{}'::jsonb)
                     - 'last_atomic_enqueue_at'
                     || jsonb_build_object(
                          'unstuck_by','admin_unstick_pending_enqueue_steps_v2',
                          'unstuck_at', now(),
                          'unstuck_reason', p_reason,
                          'previous_last_error', v_step.last_error)
          WHERE id = v_step.id
            AND status = 'pending_enqueue'::step_status;

          v_promoted := v_promoted + 1;
          v_pkg_results := v_pkg_results || jsonb_build_object('step_key', v_step.step_key, 'promoted', true);
        ELSE
          v_pkg_results := v_pkg_results || jsonb_build_object('step_key', v_step.step_key, 'skipped', 'deps_still_open', 'open_count', v_deps_open);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_pkg_results := v_pkg_results || jsonb_build_object('step_key', v_step.step_key, 'error', SQLERRM, 'sqlstate', SQLSTATE);
      END;
    END LOOP;

    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_id, target_type, result_status, result_detail, metadata)
    VALUES (
      'unstick_pending_enqueue_steps_v2',
      'admin_unstick_pending_enqueue_steps_v2',
      v_pkg_id::text,
      'package',
      CASE WHEN v_promoted > 0 THEN 'success' ELSE 'noop' END,
      format('promoted %s pending_enqueue step(s)', v_promoted),
      jsonb_build_object('reason', p_reason, 'promoted', v_promoted, 'steps', v_pkg_results)
    );

    v_results := v_results || jsonb_build_object('package_id', v_pkg_id, 'promoted', v_promoted, 'steps', v_pkg_results);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results, 'version', 'v2_entangled_heal_safe');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_unstick_pending_enqueue_steps(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unstick_pending_enqueue_steps(uuid[], text) TO service_role, authenticated;