CREATE OR REPLACE FUNCTION public.fn_job_queue_ssot_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enforce_at timestamptz := '2026-05-09 00:00:00+00'::timestamptz;
  v_enforce boolean := now() >= v_enforce_at;
  v_violations text[] := ARRAY[]::text[];
  v_missing text[] := ARRAY[]::text[];
  v_auto_derived jsonb := '{}'::jsonb;
  v_step_key text;
  v_enqueue_source text;
  v_payload_pkg uuid;
  v_producer_hint text;
  v_critical boolean := false;
BEGIN
  IF NEW.job_type NOT LIKE 'package_%' THEN
    RETURN NEW;
  END IF;

  v_producer_hint := COALESCE(
    NEW.meta->>'enqueue_source', NEW.meta->>'source',
    NEW.payload->>'enqueue_source', 'unknown_producer'
  );

  -- Auto-Heal package_id Column aus payload
  IF NEW.package_id IS NULL AND NEW.payload ? 'package_id' THEN
    BEGIN
      v_payload_pkg := (NEW.payload->>'package_id')::uuid;
      NEW.package_id := v_payload_pkg;
      v_violations := array_append(v_violations, 'auto_filled_package_id_column'::text);
      v_auto_derived := v_auto_derived || jsonb_build_object('package_id_column', v_payload_pkg::text);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  -- 1) curriculum_id Pflicht
  IF NEW.payload IS NULL OR NULLIF(NEW.payload->>'curriculum_id','') IS NULL THEN
    v_violations := array_append(v_violations, 'missing_curriculum_id'::text);
    v_missing := array_append(v_missing, 'curriculum_id'::text);
    v_critical := true;
  END IF;

  -- 2) package_id Pflicht
  IF NEW.package_id IS NULL THEN
    v_violations := array_append(v_violations, 'missing_package_id_column'::text);
    v_missing := array_append(v_missing, 'package_id_column'::text);
  END IF;
  IF NULLIF(NEW.payload->>'package_id','') IS NULL THEN
    IF NEW.package_id IS NOT NULL THEN
      NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('package_id', NEW.package_id::text);
      v_violations := array_append(v_violations, 'auto_filled_package_id_payload'::text);
      v_auto_derived := v_auto_derived || jsonb_build_object('package_id_payload', NEW.package_id::text);
    ELSE
      v_violations := array_append(v_violations, 'missing_package_id_payload'::text);
      v_missing := array_append(v_missing, 'package_id_payload'::text);
      v_critical := true;
    END IF;
  END IF;

  -- 3) step_key Pflicht (auto-derive aus job_type)
  v_step_key := COALESCE(NEW.payload->>'step_key', NEW.payload->>'step', NEW.payload->>'target_step', NEW.meta->>'step_key');
  IF v_step_key IS NULL OR v_step_key = '' THEN
    v_step_key := regexp_replace(NEW.job_type, '^package_', '');
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('step_key', v_step_key);
    v_violations := array_append(v_violations, 'auto_derived_step_key'::text);
    v_missing := array_append(v_missing, 'step_key'::text);
    v_auto_derived := v_auto_derived || jsonb_build_object('step_key', v_step_key);
  ELSIF NULLIF(NEW.payload->>'step_key','') IS NULL THEN
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('step_key', v_step_key);
    v_violations := array_append(v_violations, 'mirrored_step_key_to_payload'::text);
    v_auto_derived := v_auto_derived || jsonb_build_object('step_key_mirrored', v_step_key);
  END IF;

  -- 4) enqueue_source Pflicht
  v_enqueue_source := COALESCE(
    NEW.payload->>'enqueue_source', NEW.meta->>'enqueue_source', NEW.meta->>'source'
  );
  IF v_enqueue_source IS NULL OR v_enqueue_source = '' THEN
    v_enqueue_source := 'unknown_producer';
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    v_violations := array_append(v_violations, 'auto_derived_enqueue_source'::text);
    v_missing := array_append(v_missing, 'enqueue_source'::text);
    v_auto_derived := v_auto_derived || jsonb_build_object('enqueue_source', 'unknown_producer');
  ELSIF NULLIF(NEW.payload->>'enqueue_source','') IS NULL THEN
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    v_violations := array_append(v_violations, 'mirrored_enqueue_source_to_payload'::text);
    v_auto_derived := v_auto_derived || jsonb_build_object('enqueue_source_mirrored', v_enqueue_source);
  END IF;

  -- 5) Slug-Verbot
  IF NEW.payload ? 'slug' OR NEW.payload ? 'profession_slug'
     OR NEW.payload ? 'curriculum_slug' OR NEW.payload ? 'curriculumCode' THEN
    v_violations := array_append(v_violations, 'forbidden_slug_field'::text);
    v_critical := true;
  END IF;

  IF COALESCE(array_length(v_violations,1), 0) > 0 THEN
    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id,
      result_status, result_detail, metadata
    ) VALUES (
      CASE WHEN v_enforce AND v_critical THEN 'ssot_payload_blocked' ELSE 'ssot_payload_warn' END,
      'trg_job_queue_ssot_validate', 'job', COALESCE(NEW.package_id::text,'null'),
      CASE WHEN v_enforce AND v_critical THEN 'rejected' ELSE 'warn' END,
      format('Job %s violations: %s', NEW.job_type, array_to_string(v_violations,',')),
      jsonb_build_object(
        'job_type', NEW.job_type,
        'package_id', NEW.package_id,
        'producer', v_producer_hint,
        'violations', v_violations,
        'violations_detail', jsonb_build_object(
          'missing_fields', v_missing,
          'auto_derived', v_auto_derived,
          'producer_hint', v_producer_hint,
          'critical', v_critical,
          'phase', CASE WHEN v_enforce THEN 'enforce' ELSE 'warn' END
        )
      )
    );

    IF v_enforce AND v_critical THEN
      INSERT INTO public.job_queue_dead_letter(
        job_type, package_id, curriculum_id, payload, meta, violations, source
      ) VALUES (
        NEW.job_type, NEW.package_id,
        NULLIF(NEW.payload->>'curriculum_id','')::uuid,
        NEW.payload, NEW.meta, v_violations, v_producer_hint
      );
      RAISE EXCEPTION 'SSOT VIOLATION (job_queue insert blocked, written to DLQ): % | %',
        NEW.job_type, array_to_string(v_violations,',');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;