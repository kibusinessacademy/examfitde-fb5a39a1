CREATE OR REPLACE FUNCTION public.admin_execute_repair_for_package(_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_preview jsonb;
  v_validation jsonb;
  v_job_type text;
  v_mode text;
  v_payload jsonb;
  v_reason text;
  v_severity text;
  v_is_valid boolean;
  v_dup_exists boolean;
  v_job_id uuid;
  v_curriculum_id uuid;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  SELECT curriculum_id INTO v_curriculum_id
  FROM public.course_packages
  WHERE id = _package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'package_has_no_curriculum',
      'package_id', _package_id
    );
  END IF;

  v_preview := public.admin_dry_run_repair_for_package(_package_id);

  IF COALESCE(v_preview->>'error','') <> '' THEN
    RETURN v_preview;
  END IF;

  v_job_type := v_preview->>'job_type';
  v_mode := v_preview->>'mode';
  v_reason := COALESCE(v_preview->>'reason', 'preview_failed');
  v_severity := COALESCE(v_preview->>'severity', 'info');
  v_is_valid := COALESCE((v_preview->>'is_valid')::boolean, false);
  v_payload := COALESCE(v_preview->'resolver'->'payload', '{}'::jsonb);

  v_payload := v_payload
    || jsonb_build_object(
         'package_id', _package_id::text,
         'curriculum_id', v_curriculum_id::text,
         'is_repair', true
       );
  IF v_mode IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('mode', v_mode);
  END IF;

  IF COALESCE(v_preview->>'decision','preview_skip') <> 'preview_ok' OR v_job_type IS NULL THEN
    PERFORM public.fn_log_queue_validation(
      'execute'::text, NULL::text, NULL::uuid, _package_id, COALESCE(v_job_type,'(none)')::text, v_mode::text,
      v_is_valid, v_severity::text, v_reason::text, 'skipped'::text,
      jsonb_build_object('preview', v_preview),
      v_preview->'validation'
    );
    RETURN jsonb_build_object(
      'ok', false, 'decision', 'skipped', 'reason', v_reason, 'preview', v_preview
    );
  END IF;

  v_validation := public.admin_validate_repair_job_type(v_job_type, v_payload);
  v_is_valid := COALESCE((v_validation->>'valid')::boolean, false);
  v_severity := COALESCE(v_validation->>'severity', v_severity);
  v_reason := COALESCE(v_validation->>'warning', v_reason);

  IF NOT v_is_valid AND v_severity = 'high' THEN
    PERFORM public.fn_log_queue_validation(
      'execute'::text, NULL::text, NULL::uuid, _package_id, v_job_type::text, v_mode::text,
      false, v_severity::text, v_reason::text, 'skipped'::text,
      jsonb_build_object('preview', v_preview),
      v_validation
    );
    RETURN jsonb_build_object(
      'ok', false, 'decision', 'skipped', 'reason', v_reason,
      'validation', v_validation, 'preview', v_preview
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.job_queue j
    WHERE j.package_id = _package_id
      AND j.job_type = v_job_type
      AND j.status = ANY(public.fn_job_active_statuses())
      AND COALESCE(j.payload->>'mode','') = COALESCE(v_mode,'')
  ) INTO v_dup_exists;

  IF v_dup_exists THEN
    PERFORM public.fn_log_queue_validation(
      'execute'::text, NULL::text, NULL::uuid, _package_id, v_job_type::text, v_mode::text,
      true, 'info'::text, 'duplicate_active_job'::text, 'skipped'::text,
      jsonb_build_object('preview', v_preview),
      v_validation
    );
    RETURN jsonb_build_object(
      'ok', false, 'decision', 'skipped', 'reason', 'duplicate_active_job', 'preview', v_preview
    );
  END IF;

  INSERT INTO public.job_queue(
    job_type, package_id, payload, status, run_after, priority, max_attempts, meta
  )
  VALUES (
    v_job_type, _package_id, v_payload, 'pending', now() + interval '15 seconds', 100, 3,
    jsonb_build_object(
      'manual_repair', true,
      'repair_source', 'validation_audit_drilldown',
      'curriculum_id', v_curriculum_id,
      'preview', v_preview,
      'job_type_validation', v_validation
    )
  )
  RETURNING id INTO v_job_id;

  -- FIX: v_job_id gehört an Position 3 (_source_job_id uuid), Position 2 (_cluster) muss text sein.
  PERFORM public.fn_log_queue_validation(
    'execute'::text, NULL::text, v_job_id, _package_id, v_job_type::text, v_mode::text,
    true, v_severity::text, COALESCE(v_preview->>'reason', 'enqueued')::text, 'enqueued'::text,
    jsonb_build_object('preview', v_preview, 'job_id', v_job_id),
    v_validation
  );

  RETURN jsonb_build_object(
    'ok', true,
    'decision', 'enqueued',
    'job_id', v_job_id,
    'job_type', v_job_type,
    'mode', v_mode,
    'preview', v_preview
  );
END;
$function$;