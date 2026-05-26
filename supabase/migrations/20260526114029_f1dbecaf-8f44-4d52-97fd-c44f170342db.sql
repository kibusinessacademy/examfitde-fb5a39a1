
-- 1) Register audit contract (idempotent)
INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module)
VALUES (
  'background_agent_action_dispatched',
  ARRAY['source_type','source_id','action','route','outcome'],
  1,
  'p70_background_agent_cockpit'
)
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      schema_version = EXCLUDED.schema_version,
      owner_module = EXCLUDED.owner_module,
      updated_at = now();

-- 2) Action dispatcher — single choke point.
--    NO new tables. Routes to existing RPCs only.
CREATE OR REPLACE FUNCTION public.admin_background_agent_dispatch_action(
  p_source_type text,
  p_source_id  text,
  p_action     text,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_package_id uuid;
  v_status text;
  v_step_key text;
  v_result jsonb;
  v_route text;
BEGIN
  -- Admin gate
  IF NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    PERFORM public.fn_emit_audit(
      'background_agent_action_dispatched','background_agent',p_source_id,'denied',
      jsonb_build_object(
        'source_type',p_source_type,'source_id',p_source_id,
        'action',p_action,'route','none','outcome','forbidden_not_admin'),
      'p70_background_agent_cockpit',
      'caller is not admin'
    );
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Whitelist source/action combinations
  IF p_source_type NOT IN
     ('job_queue','system_intents','berufs_ki_agent_runs',
      'runtime_action_results','heal_permanent_fix_tasks') THEN
    RAISE EXCEPTION 'unknown source_type: %', p_source_type;
  END IF;

  IF p_action NOT IN ('retry','cancel','approve','nudge') THEN
    RAISE EXCEPTION 'unsupported action: %', p_action;
  END IF;

  -- Route per source_type
  CASE p_source_type
    WHEN 'job_queue' THEN
      SELECT jq.package_id, jq.status, COALESCE(jq.payload->>'step_key', jq.job_type)
        INTO v_package_id, v_status, v_step_key
      FROM public.job_queue jq
      WHERE jq.id::text = p_source_id;

      IF v_package_id IS NULL THEN
        RAISE EXCEPTION 'job_queue row not found or has no package_id';
      END IF;

      IF p_action = 'retry' THEN
        IF v_status NOT IN ('failed','cancelled','blocked') THEN
          RAISE EXCEPTION 'retry only allowed on failed/cancelled/blocked (got %)', v_status;
        END IF;
        v_route := 'admin_retry_failed_step';
        v_result := public.admin_retry_failed_step(v_package_id, v_step_key,
          COALESCE(p_reason,'cockpit_p70_2'));
      ELSIF p_action = 'cancel' THEN
        IF v_status NOT IN ('queued','pending','processing','blocked') THEN
          RAISE EXCEPTION 'cancel only on active states (got %)', v_status;
        END IF;
        v_route := 'cancel_jobs_for_package';
        PERFORM public.cancel_jobs_for_package(
          v_package_id,
          (SELECT job_type FROM public.job_queue WHERE id::text = p_source_id),
          ARRAY['queued','pending','processing','blocked']::text[],
          COALESCE(p_reason,'cockpit_p70_2_cancel'));
        v_result := jsonb_build_object('cancelled', true);
      ELSIF p_action = 'nudge' THEN
        v_route := 'admin_nudge_atomic_trigger';
        v_result := public.admin_nudge_atomic_trigger(v_package_id, false);
      ELSE
        RAISE EXCEPTION 'action % not supported for job_queue', p_action;
      END IF;

    WHEN 'berufs_ki_agent_runs' THEN
      -- Only approval is supported (no retry RPC exists). approve = bronze publish path
      -- when bound to a package.
      IF p_action = 'approve' THEN
        SELECT (run.metadata->>'package_id')::uuid INTO v_package_id
        FROM public.berufs_ki_agent_runs run
        WHERE run.id::text = p_source_id;
        IF v_package_id IS NULL THEN
          RAISE EXCEPTION 'agent run has no package_id to approve against';
        END IF;
        v_route := 'admin_bronze_manual_approve_for_publish';
        v_result := public.admin_bronze_manual_approve_for_publish(v_package_id,
          COALESCE(p_reason,'cockpit_p70_2_approve'));
      ELSE
        RAISE EXCEPTION 'action % not supported for berufs_ki_agent_runs', p_action;
      END IF;

    ELSE
      RAISE EXCEPTION 'no mutating action available for source_type %', p_source_type;
  END CASE;

  PERFORM public.fn_emit_audit(
    'background_agent_action_dispatched','background_agent',p_source_id,'ok',
    jsonb_build_object(
      'source_type',p_source_type,'source_id',p_source_id,
      'action',p_action,'route',v_route,'outcome','dispatched',
      'package_id',v_package_id,'reason',p_reason,'result',v_result),
    'p70_background_agent_cockpit',
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', p_action,
    'route', v_route,
    'source_type', p_source_type,
    'source_id', p_source_id,
    'package_id', v_package_id,
    'result', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_background_agent_dispatch_action(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_background_agent_dispatch_action(text,text,text,text) TO authenticated, service_role;
