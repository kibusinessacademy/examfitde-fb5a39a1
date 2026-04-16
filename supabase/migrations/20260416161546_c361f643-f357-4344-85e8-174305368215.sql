
CREATE OR REPLACE FUNCTION public.admin_force_steps_done(
  p_package_id uuid,
  p_step_keys text[],
  p_reason text DEFAULT 'manual_admin_backfill'::text,
  p_emergency_bypass boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated INT;
  v_bypassed_triggers text[];
BEGIN
  -- ALWAYS bypass: causality (ordering) + governance (meta contract checks)
  ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_causality;
  ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_governance_step_finalization;
  v_bypassed_triggers := ARRAY['trg_guard_step_causality', 'trg_guard_governance_step_finalization'];

  -- EMERGENCY ONLY: bypass all remaining guard triggers
  -- Requires explicit p_emergency_bypass = true
  IF p_emergency_bypass THEN
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_quality_council_requires_execution;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_integrity_requires_execution;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_auto_publish_done;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_auto_publish_preconditions;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_ghost_completion;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_ghost_step_finalization;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_hollow_done;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_oral_exam_completeness;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_done_regression;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_done_thresholds;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_package_step_meta_contract;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_block_publish_on_stale_integrity;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_council_step_reset;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_exception_approved;
    ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_failed_requires_reason;
    v_bypassed_triggers := v_bypassed_triggers || ARRAY[
      'trg_guard_quality_council_requires_execution',
      'trg_guard_integrity_requires_execution',
      'trg_guard_auto_publish_done',
      'trg_guard_auto_publish_preconditions',
      'trg_guard_ghost_completion',
      'trg_guard_ghost_step_finalization',
      'trg_guard_hollow_done',
      'trg_guard_oral_exam_completeness',
      'trg_guard_step_done_regression',
      'trg_guard_step_done_thresholds',
      'trg_guard_package_step_meta_contract',
      'trg_block_publish_on_stale_integrity',
      'trg_guard_council_step_reset',
      'trg_guard_exception_approved',
      'trg_guard_step_failed_requires_reason'
    ];
  END IF;

  UPDATE public.package_steps
  SET status = 'done',
      started_at = COALESCE(started_at, now()),
      updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'ok', true,
        'done_reason', p_reason,
        'force_done_at', now(),
        'emergency_bypass', p_emergency_bypass,
        'bypassed_triggers', to_jsonb(v_bypassed_triggers)
      )
  WHERE package_id = p_package_id
    AND step_key = ANY(p_step_keys)
    AND status != 'done';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Re-enable ALL guard triggers (safe: enabling already-enabled is a no-op)
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_step_causality;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_governance_step_finalization;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_quality_council_requires_execution;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_integrity_requires_execution;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_auto_publish_done;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_auto_publish_preconditions;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_ghost_completion;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_ghost_step_finalization;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_hollow_done;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_oral_exam_completeness;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_step_done_regression;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_step_done_thresholds;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_package_step_meta_contract;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_block_publish_on_stale_integrity;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_council_step_reset;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_exception_approved;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_step_failed_requires_reason;

  -- Audit log with full forensic metadata
  INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'force_steps_done',
    'package_steps',
    jsonb_build_object(
      'package_id', p_package_id,
      'step_keys', to_jsonb(p_step_keys),
      'reason', p_reason,
      'rows_updated', v_updated,
      'emergency_bypass', p_emergency_bypass,
      'bypassed_triggers', to_jsonb(v_bypassed_triggers)
    ),
    ARRAY[p_package_id::text]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'updated', v_updated,
    'package_id', p_package_id,
    'emergency_bypass', p_emergency_bypass,
    'bypassed_trigger_count', array_length(v_bypassed_triggers, 1)
  );
END;
$function$;
