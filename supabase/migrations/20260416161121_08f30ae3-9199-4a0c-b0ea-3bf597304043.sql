
CREATE OR REPLACE FUNCTION public.admin_force_steps_done(p_package_id uuid, p_step_keys text[], p_reason text DEFAULT 'manual_admin_backfill'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated INT;
BEGIN
  -- Temporarily disable causality guard within this transaction
  ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_causality;
  -- Also disable governance guard for manual admin bypass
  ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_governance_step_finalization;

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

  -- Re-enable guards
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_step_causality;
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_governance_step_finalization;

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
