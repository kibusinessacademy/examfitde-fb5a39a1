
-- 1. Admin-Safe-Backfill-Funktion
CREATE OR REPLACE FUNCTION public.admin_force_steps_done(
  p_package_id UUID,
  p_step_keys TEXT[],
  p_reason TEXT DEFAULT 'manual_admin_backfill'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  -- Temporarily disable causality guard within this transaction
  ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_causality;

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

  -- Re-enable guard
  ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_step_causality;

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
$$;

-- 2. Enhance causality guard to log reverts visibly
CREATE OR REPLACE FUNCTION public.fn_guard_step_causality()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  unmet_dep TEXT;
BEGIN
  -- Only check transitions TO 'done'
  IF NEW.status != 'done' THEN RETURN NEW; END IF;
  -- Allow meta-only updates on already-done steps
  IF OLD IS NOT NULL AND OLD.status = 'done' AND NEW.status = 'done' THEN RETURN NEW; END IF;

  -- Check all DAG dependencies
  SELECT dag.depends_on INTO unmet_dep
  FROM pipeline_dag_edges dag
  JOIN package_steps ps_dep ON ps_dep.package_id = NEW.package_id
                            AND ps_dep.step_key = dag.depends_on
  WHERE dag.step_key = NEW.step_key
    AND ps_dep.status NOT IN ('done', 'skipped')
  LIMIT 1;

  IF unmet_dep IS NOT NULL THEN
    RAISE WARNING 'CAUSALITY_GUARD: Cannot set %.% to done — dep "%" not met. Reverting to queued.',
      NEW.package_id, NEW.step_key, unmet_dep;

    -- Log revert as admin notification for visibility
    INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
    VALUES (
      'Causality-Guard Revert',
      format('Step "%s" für Paket %s wurde auf queued zurückgesetzt. Unerfüllte Abhängigkeit: "%s".',
             NEW.step_key, NEW.package_id, unmet_dep),
      'warning',
      'pipeline',
      'package_step',
      NEW.package_id::text
    );

    NEW.status := 'queued';
    NEW.last_error := 'CAUSALITY_BLOCKED: dep ' || unmet_dep || ' not done';
    NEW.job_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;
