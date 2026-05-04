CREATE OR REPLACE FUNCTION public.admin_unstick_pending_enqueue_steps(
  p_package_ids uuid[],
  p_reason text DEFAULT 'forensic_unstick_pending_enqueue'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg_id uuid;
  v_step RECORD;
  v_deps_open int;
  v_results jsonb := '[]'::jsonb;
  v_pkg_results jsonb;
  v_promoted int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no package ids provided');
  END IF;

  FOREACH v_pkg_id IN ARRAY p_package_ids LOOP
    v_pkg_results := '[]'::jsonb;
    v_promoted := 0;

    -- Iterate pending_enqueue steps and check if deps are actually satisfied
    FOR v_step IN
      SELECT ps.id, ps.step_key, ps.status::text AS status, ps.last_error
      FROM public.package_steps ps
      WHERE ps.package_id = v_pkg_id
        AND ps.status = 'pending_enqueue'
    LOOP
      -- Count open deps via step_dag_edges
      SELECT count(*) INTO v_deps_open
      FROM public.step_dag_edges dag
      JOIN public.package_steps dep_ps
        ON dep_ps.package_id = v_pkg_id
       AND dep_ps.step_key = dag.depends_on
      WHERE dag.step_key = v_step.step_key
        AND dep_ps.status NOT IN ('done','skipped');

      IF v_deps_open = 0 THEN
        BEGIN
          UPDATE public.package_steps
          SET status = 'queued'::step_status,
              attempts = 0,
              last_error = NULL,
              started_at = NULL,
              finished_at = NULL,
              last_heartbeat_at = NULL,
              updated_at = now(),
              meta = COALESCE(meta,'{}'::jsonb)
                     || jsonb_build_object(
                          'unstuck_by','admin_unstick_pending_enqueue_steps',
                          'unstuck_at', now(),
                          'unstuck_reason', p_reason,
                          'previous_last_error', v_step.last_error)
          WHERE id = v_step.id;
          v_promoted := v_promoted + 1;
          v_pkg_results := v_pkg_results || jsonb_build_object(
            'step_key', v_step.step_key, 'promoted', true);
        EXCEPTION WHEN OTHERS THEN
          v_pkg_results := v_pkg_results || jsonb_build_object(
            'step_key', v_step.step_key, 'error', SQLERRM, 'sqlstate', SQLSTATE);
        END;
      ELSE
        v_pkg_results := v_pkg_results || jsonb_build_object(
          'step_key', v_step.step_key, 'skipped', true,
          'reason', 'deps_still_open', 'open_count', v_deps_open);
      END IF;
    END LOOP;

    -- Trigger atomic enqueue for the package (best-effort)
    IF v_promoted > 0 THEN
      BEGIN PERFORM public.admin_nudge_atomic_trigger(v_pkg_id);
      EXCEPTION WHEN OTHERS THEN
        v_pkg_results := v_pkg_results || jsonb_build_object(
          'phase','atomic_nudge', 'error', SQLERRM, 'sqlstate', SQLSTATE);
      END;
    END IF;

    INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('unstick_pending_enqueue_steps', v_pkg_id::text, 'package',
            CASE WHEN v_promoted > 0 THEN 'success' ELSE 'noop' END,
            format('promoted %s pending_enqueue step(s)', v_promoted),
            jsonb_build_object('reason', p_reason, 'promoted', v_promoted, 'steps', v_pkg_results));

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg_id, 'promoted', v_promoted, 'steps', v_pkg_results);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results, 'version', 'v1_unstick');
END $$;

REVOKE ALL ON FUNCTION public.admin_unstick_pending_enqueue_steps(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_unstick_pending_enqueue_steps(uuid[], text) TO service_role, authenticated;

-- Run it now for the 5 stuck control-lane packages
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.admin_unstick_pending_enqueue_steps(
    ARRAY[
      'a02cde5e-a0ad-45fc-a5db-ffe239d387f5',
      '586c6a12-3042-46d2-8981-5d7645b2cbf6',
      '4866a5b0-1430-4ab3-825b-141605d99612',
      '55edacdf-5230-4e9a-b9c1-dcde00b8cd47',
      '41b8c6db-059b-44ff-986b-5d2e7f212a0c'
    ]::uuid[],
    'forensic_control_lane_unstick_v1'
  );
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
  VALUES ('forensic_control_lane_unstick_invocation', 'system', 'success',
          'admin_unstick_pending_enqueue_steps run for 5 packages', v_result);
  RAISE NOTICE 'Unstick result: %', v_result;
END $$;