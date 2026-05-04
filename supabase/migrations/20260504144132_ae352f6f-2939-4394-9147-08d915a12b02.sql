CREATE OR REPLACE FUNCTION public.fn_blueprint_fill_completion_to_competency_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_package_id uuid;
  v_curriculum_id uuid;
  v_target_ids jsonb;
  v_target_id_array text[];
  v_inserted_blueprints int;
  v_existing_blueprints int := 0;
  v_treat_as_existing_success boolean := false;
  v_idem_key text;
  v_target_per_competency int;
  v_payload jsonb;
BEGIN
  IF NEW.job_type <> 'package_generate_blueprint_variants' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload->>'mode','') <> 'targeted_blueprint_fill' THEN
    RETURN NEW;
  END IF;

  v_package_id    := COALESCE((NEW.payload->>'package_id')::uuid, NEW.package_id);
  v_curriculum_id := (NEW.payload->>'curriculum_id')::uuid;
  v_target_ids    := COALESCE(NEW.result->'target_competency_ids', NEW.result->'target_competencies', NEW.payload->'target_competency_ids', '[]'::jsonb);
  v_inserted_blueprints := COALESCE((NEW.result->>'inserted_blueprints')::int, 0);
  v_target_per_competency := COALESCE((NEW.payload->>'target_per_competency')::int, 6);

  IF v_package_id IS NULL OR v_curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_target_ids) ORDER BY 1)
    INTO v_target_id_array;

  IF COALESCE(array_length(v_target_id_array, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF v_inserted_blueprints <= 0 THEN
    SELECT COUNT(*)::int
      INTO v_existing_blueprints
    FROM public.question_blueprints qb
    WHERE qb.package_id = v_package_id
      AND qb.curriculum_id = v_curriculum_id
      AND qb.competency_id = ANY(v_target_id_array::uuid[])
      AND qb.status IN ('draft','approved');

    v_treat_as_existing_success := v_existing_blueprints > 0;
  END IF;

  IF v_inserted_blueprints <= 0 AND NOT v_treat_as_existing_success THEN
    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'targeted_blueprint_fill_continuation_skipped',
      'course_package',
      v_package_id,
      'noop',
      'inserted_blueprints=0 and no existing target blueprints — no continuation enqueued',
      jsonb_build_object(
        'source_job_id', NEW.id,
        'package_id', v_package_id,
        'inserted_blueprints', v_inserted_blueprints,
        'existing_blueprints', v_existing_blueprints,
        'reason', COALESCE(NEW.result->>'reason', 'NO_TARGETED_BLUEPRINTS_INSERTED')
      )
    );
    RETURN NEW;
  END IF;

  v_idem_key := 'bpfill2compfill:' || v_package_id::text || ':' || md5(array_to_string(v_target_id_array, ','));

  v_payload := jsonb_build_object(
    'package_id', v_package_id,
    'curriculum_id', v_curriculum_id,
    'mode', 'targeted_competency_fill',
    'is_repair', true,
    'target_competency_ids', to_jsonb(v_target_id_array),
    'target_per_competency', v_target_per_competency,
    'step_key', 'generate_exam_pool',
    'enqueue_source', 'targeted_fill_blueprint_recovery',
    '_origin', 'targeted_fill_blueprint_recovery',
    '_origin_job_id', NEW.id,
    'continuation_depth', COALESCE((NEW.payload->>'continuation_depth')::int, 0) + 1,
    'continuation_key', v_idem_key,
    'parent_job_id', NEW.id,
    'root_job_id', COALESCE((NEW.payload->>'root_job_id')::uuid, NEW.id),
    'requeue_tail_after_success', true
  );

  BEGIN
    INSERT INTO public.job_queue (
      job_type, status, payload, package_id, idempotency_key, priority,
      worker_pool, parent_job_id, root_job_id
    ) VALUES (
      'package_generate_exam_pool',
      'pending',
      v_payload,
      v_package_id,
      v_idem_key,
      25,
      'default',
      NEW.id,
      COALESCE((NEW.payload->>'root_job_id')::uuid, NEW.id)
    );

    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'targeted_blueprint_fill_continuation_enqueued',
      'course_package',
      v_package_id,
      'success',
      format('enqueued targeted_competency_fill for %s competencies (inserted_blueprints=%s existing_blueprints=%s)',
             array_length(v_target_id_array, 1), v_inserted_blueprints, v_existing_blueprints),
      jsonb_build_object(
        'source_job_id', NEW.id,
        'package_id', v_package_id,
        'idempotency_key', v_idem_key,
        'target_competency_ids', to_jsonb(v_target_id_array),
        'inserted_blueprints', v_inserted_blueprints,
        'existing_blueprints', v_existing_blueprints,
        'completed_existing_blueprints', v_treat_as_existing_success
      )
    );

  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'targeted_blueprint_fill_continuation_deferred',
      'course_package',
      v_package_id,
      'noop',
      'unique_violation on idempotency_key — handled by existing active job',
      jsonb_build_object(
        'source_job_id', NEW.id,
        'idempotency_key', v_idem_key,
        'sqlstate', SQLSTATE,
        'note', 'deferred/handled by trigger'
      )
    );
  END;

  RETURN NEW;
END;
$function$;