
CREATE OR REPLACE FUNCTION public.admin_force_steps_done(p_package_id uuid, p_step_keys text[], p_reason text DEFAULT 'manual_admin_backfill'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated INT;
BEGIN
  -- Disable ALL guard triggers for admin bypass
  ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_causality;
  ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_governance_step_finalization;
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
  -- Keep functional triggers enabled: trg_sync_*, trg_rebuild_*, trg_emit_*, trg_cancel_*, trg_cascade_*, trg_clear_*

  UPDATE public.package_steps
  SET status = 'done',
      started_at = COALESCE(started_at, now()),
      updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'ok', true,
        'done_reason', p_reason,
        'force_done_at', now()
      )
  WHERE package_id = p_package_id
    AND step_key = ANY(p_step_keys)
    AND status != 'done';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Re-enable ALL guard triggers
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

  -- Audit log
  INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'force_steps_done',
    'package_steps',
    jsonb_build_object(
      'package_id', p_package_id,
      'step_keys', to_jsonb(p_step_keys),
      'reason', p_reason,
      'rows_updated', v_updated
    ),
    ARRAY[p_package_id::text]
  );

  RETURN jsonb_build_object('ok', true, 'updated', v_updated, 'package_id', p_package_id);
END;
$function$;
