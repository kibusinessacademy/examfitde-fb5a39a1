-- ─────────────────────────────────────────────────────────────────────
-- Phase A.2 — Phantom Pre-Enqueue Guard: bypass targeted_blueprint_fill
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_step_already_terminal(
  p_job_type text,
  p_package_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- Existing bypasses (competency repair)
    WHEN COALESCE(p_payload->>'_origin','') = 'competency_coverage_repair' THEN false
    WHEN COALESCE(p_payload->>'mode','') = 'targeted_competency_fill' THEN false
    WHEN COALESCE(p_payload->>'enqueue_source','') = 'competency_coverage_repair' THEN false
    -- Phase A.2: targeted blueprint fill recovery
    WHEN COALESCE(p_payload->>'mode','') = 'targeted_blueprint_fill' THEN false
    WHEN COALESCE(p_payload->>'_origin','') = 'targeted_fill_blueprint_recovery' THEN false
    WHEN COALESCE(p_payload->>'enqueue_source','') = 'targeted_fill_blueprint_recovery' THEN false
    ELSE EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = p_package_id
        AND ps.step_key = regexp_replace(p_job_type, '^package_', '')
        AND ps.status IN ('done','skipped')
    )
  END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- Phase A.3+A.4 — Completion-Trigger + Idempotency-Key
-- ─────────────────────────────────────────────────────────────────────
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
  v_idem_key text;
  v_target_per_competency int;
  v_payload jsonb;
BEGIN
  -- Only react to package_generate_blueprint_variants completions in mode=targeted_blueprint_fill
  IF NEW.job_type <> 'package_generate_blueprint_variants' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload->>'mode','') <> 'targeted_blueprint_fill' THEN
    RETURN NEW;
  END IF;

  v_package_id    := (NEW.payload->>'package_id')::uuid;
  v_curriculum_id := (NEW.payload->>'curriculum_id')::uuid;
  v_target_ids    := COALESCE(NEW.result->'target_competency_ids', NEW.payload->'target_competency_ids', '[]'::jsonb);
  v_inserted_blueprints := COALESCE((NEW.result->>'inserted_blueprints')::int, 0);
  v_target_per_competency := COALESCE((NEW.payload->>'target_per_competency')::int, 6);

  -- Skip if no blueprints were actually inserted
  IF v_inserted_blueprints <= 0 THEN
    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'targeted_blueprint_fill_continuation_skipped',
      'course_package',
      v_package_id,
      'noop',
      'inserted_blueprints=0 — no continuation enqueued',
      jsonb_build_object(
        'source_job_id', NEW.id,
        'package_id', v_package_id,
        'inserted_blueprints', v_inserted_blueprints,
        'reason', COALESCE(NEW.result->>'reason', 'NO_TARGETED_BLUEPRINTS_INSERTED')
      )
    );
    RETURN NEW;
  END IF;

  IF v_package_id IS NULL OR v_curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Build deterministic idempotency-key
  -- Sorted target ids → stable hash regardless of payload ordering
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_target_ids) ORDER BY 1)
    INTO v_target_id_array;

  v_idem_key := 'bpfill2compfill:' || v_package_id::text || ':'
                || encode(digest(array_to_string(v_target_id_array, ','), 'sha256'), 'hex');

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

  -- Insert continuation job; rely on unique partial index job_queue_idempotency_active
  -- to guarantee at-most-one active continuation per (package, target-set).
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
      format('enqueued targeted_competency_fill for %s competencies (inserted_blueprints=%s)',
             array_length(v_target_id_array, 1), v_inserted_blueprints),
      jsonb_build_object(
        'source_job_id', NEW.id,
        'package_id', v_package_id,
        'idempotency_key', v_idem_key,
        'target_competency_ids', to_jsonb(v_target_id_array),
        'inserted_blueprints', v_inserted_blueprints
      )
    );

  EXCEPTION WHEN unique_violation THEN
    -- Active continuation already exists — handled by trigger, not an error
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

DROP TRIGGER IF EXISTS trg_blueprint_fill_completion_to_competency_fill ON public.job_queue;

CREATE TRIGGER trg_blueprint_fill_completion_to_competency_fill
AFTER UPDATE OF status ON public.job_queue
FOR EACH ROW
WHEN (
  NEW.status = 'completed'
  AND OLD.status IS DISTINCT FROM 'completed'
  AND NEW.job_type = 'package_generate_blueprint_variants'
)
EXECUTE FUNCTION public.fn_blueprint_fill_completion_to_competency_fill();

COMMENT ON FUNCTION public.fn_blueprint_fill_completion_to_competency_fill IS
'Phase A continuation: when targeted_blueprint_fill completes with inserted_blueprints>0, enqueue exactly one targeted_competency_fill follow-up. Idempotency-key derives from package_id + sha256(sorted target_competency_ids).';