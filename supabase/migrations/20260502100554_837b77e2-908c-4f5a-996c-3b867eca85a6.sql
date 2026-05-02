-- ============================================================================
-- SSOT Producer Hardening v1 (2026-05-02)
-- Patcht reconcile_queued_steps_to_jobs (Hauptproducer ohne step_key/enqueue_source)
-- + erweitert SSOT-Trigger um Auto-Derive von enqueue_source + package_id-Column
-- ============================================================================

-- 1) reconcile_queued_steps_to_jobs SSOT-konform machen
CREATE OR REPLACE FUNCTION public.reconcile_queued_steps_to_jobs(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_pkg record;
BEGIN
  SELECT cp.id, cp.curriculum_id, cp.course_id, cp.certification_id,
         cp.feature_flags, cp.status as pkg_status
  INTO v_pkg
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_pkg IS NULL THEN
    RETURN jsonb_build_object('error', 'package not found');
  END IF;

  IF v_pkg.pkg_status NOT IN ('building', 'quality_gate_failed', 'blocked') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'package not in actionable state', 'status', v_pkg.pkg_status);
  END IF;

  -- SSOT FIX: package_id Column + step_key + enqueue_source vollständig in payload
  INSERT INTO job_queue (job_type, package_id, payload, status, meta, created_at, updated_at)
  SELECT
    'package_' || ps.step_key,
    ps.package_id,                              -- ← package_id Column gefüllt
    jsonb_build_object(
      'package_id', ps.package_id::text,
      'curriculum_id', v_pkg.curriculum_id::text,
      'course_id', v_pkg.course_id::text,
      'certification_id', v_pkg.certification_id::text,
      'step_key', ps.step_key,                  -- ← Pflicht
      'enqueue_source', 'reconcile_queued_steps_to_jobs', -- ← Pflicht
      'mode', 'factory',
      'reconciled', true,
      'reconciled_at', now()::text
    ),
    'pending',
    jsonb_build_object(
      'source', 'reconcile_queued_steps_to_jobs',
      'enqueue_source', 'reconcile_queued_steps_to_jobs',
      'step_key', ps.step_key,
      'mode', 'factory',
      'reconciled_at', now()
    ),
    now(),
    now()
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued'
    AND v_pkg.curriculum_id IS NOT NULL  -- fail-loud Guard
    AND EXISTS (
      SELECT 1 FROM ops_job_type_registry r
      WHERE r.job_type = 'package_' || ps.step_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM job_queue jq
      WHERE jq.package_id = ps.package_id
        AND jq.job_type = 'package_' || ps.step_key
        AND jq.status IN ('pending','queued','processing')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Wenn curriculum_id fehlt → fail-loud audit
  IF v_count = 0 AND v_pkg.curriculum_id IS NULL THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                              result_status, result_detail, metadata)
    VALUES ('reconcile_blocked_missing_curriculum',
            'reconcile_queued_steps_to_jobs', 'package', p_package_id::text,
            'rejected', 'Cannot reconcile: package missing curriculum_id',
            jsonb_build_object('package_id', p_package_id));
  END IF;

  RETURN jsonb_build_object('reconciled_jobs', v_count, 'package_id', p_package_id::text);
END;
$function$;

-- 2) SSOT-Trigger erweitern: enqueue_source + package_id-Column Auto-Heal
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
  v_step_key text;
  v_enqueue_source text;
  v_payload_pkg uuid;
BEGIN
  IF NEW.job_type NOT LIKE 'package_%' THEN
    RETURN NEW;
  END IF;

  -- Auto-Heal package_id Column aus payload (häufige Lücke bei direct-INSERT Producern)
  IF NEW.package_id IS NULL AND NEW.payload ? 'package_id' THEN
    BEGIN
      v_payload_pkg := (NEW.payload->>'package_id')::uuid;
      NEW.package_id := v_payload_pkg;
      v_violations := v_violations || 'auto_filled_package_id_column';
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  -- 1) curriculum_id Pflicht
  IF NEW.payload IS NULL OR NULLIF(NEW.payload->>'curriculum_id','') IS NULL THEN
    v_violations := v_violations || 'missing_curriculum_id';
  END IF;

  -- 2) package_id Pflicht
  IF NEW.package_id IS NULL THEN
    v_violations := v_violations || 'missing_package_id_column';
  END IF;
  IF NULLIF(NEW.payload->>'package_id','') IS NULL THEN
    v_violations := v_violations || 'missing_package_id_payload';
  END IF;

  -- 3) step_key Pflicht (auto-derive aus job_type)
  v_step_key := COALESCE(NEW.payload->>'step_key', NEW.payload->>'step', NEW.payload->>'target_step');
  IF v_step_key IS NULL OR v_step_key = '' THEN
    v_step_key := regexp_replace(NEW.job_type, '^package_', '');
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('step_key', v_step_key);
    v_violations := v_violations || 'auto_derived_step_key';
  END IF;

  -- 4) enqueue_source Pflicht (auto-derive aus meta oder default)
  v_enqueue_source := COALESCE(
    NEW.payload->>'enqueue_source',
    NEW.meta->>'enqueue_source',
    NEW.meta->>'source'
  );
  IF v_enqueue_source IS NULL OR v_enqueue_source = '' THEN
    v_enqueue_source := 'unknown_producer';
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    v_violations := v_violations || 'auto_derived_enqueue_source';
  ELSIF NULLIF(NEW.payload->>'enqueue_source','') IS NULL THEN
    -- Vorhanden in meta aber nicht in payload → spiegeln
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('enqueue_source', v_enqueue_source);
    v_violations := v_violations || 'mirrored_enqueue_source_to_payload';
  END IF;

  -- 5) Slug-Verbot
  IF NEW.payload ? 'slug' OR NEW.payload ? 'profession_slug'
     OR NEW.payload ? 'curriculum_slug' OR NEW.payload ? 'curriculumCode' THEN
    v_violations := v_violations || 'forbidden_slug_field';
  END IF;

  IF array_length(v_violations,1) > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES (
      CASE WHEN v_enforce THEN 'ssot_payload_blocked' ELSE 'ssot_payload_warn' END,
      'trg_job_queue_ssot_validate', 'job', COALESCE(NEW.package_id::text,'null'),
      CASE WHEN v_enforce THEN 'rejected' ELSE 'warn' END,
      format('Job %s violations: %s', NEW.job_type, array_to_string(v_violations,',')),
      jsonb_build_object(
        'job_type', NEW.job_type,
        'package_id', NEW.package_id,
        'violations', v_violations,
        'enqueue_source', v_enqueue_source,
        'phase', CASE WHEN v_enforce THEN 'enforce' ELSE 'warn' END
      )
    );
    -- Hard-Block nur bei kritischen Violations
    IF v_enforce AND (
       'missing_curriculum_id' = ANY(v_violations)
       OR 'missing_package_id_payload' = ANY(v_violations)
       OR 'forbidden_slug_field' = ANY(v_violations)
    ) THEN
      RAISE EXCEPTION 'SSOT VIOLATION (job_queue insert blocked): % | %',
        NEW.job_type, array_to_string(v_violations,',');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Audit
INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                 result_status, result_detail, metadata)
VALUES ('ssot_producer_hardening_v1', 'migration', 'system', 'job_queue',
        'done',
        'reconcile_queued_steps_to_jobs patched + ssot trigger erweitert um enqueue_source + package_id-column auto-heal',
        jsonb_build_object('producers_patched', ARRAY['reconcile_queued_steps_to_jobs'],
                           'trigger_extended', 'fn_job_queue_ssot_validate'));
