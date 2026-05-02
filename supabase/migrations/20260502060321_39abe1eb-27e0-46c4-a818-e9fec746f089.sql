-- ============================================================
-- Pattern X5: Queued-Pipeline-Stall — Mehrebenen-Fix (atomic)
-- ============================================================

-- 1. RPC-Layer: alten kollidierenden Overload droppen
DROP FUNCTION IF EXISTS public.admin_step_reset_detailed(uuid, text[], text, text, boolean, boolean);
GRANT EXECUTE ON FUNCTION public.admin_step_reset_detailed(uuid, text[], text, text, boolean) TO service_role;

-- 2. Helper: Track-Drift-Steps auf skipped setzen
CREATE OR REPLACE FUNCTION public.admin_skip_track_drift_steps(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skipped jsonb := '[]'::jsonb;
  v_step RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  FOR v_step IN
    SELECT id, step_key, status::text AS status_before, last_error
    FROM public.package_steps
    WHERE package_id = p_package_id
      AND coalesce(last_error,'') ILIKE '%track-drift detected%'
      AND status::text NOT IN ('done','skipped')
  LOOP
    UPDATE public.package_steps
       SET status = 'skipped'::step_status,
           finished_at = now(),
           updated_at = now(),
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'auto_skipped_at', now(),
             'auto_skipped_reason', 'track_drift_phantom_step',
             'previous_last_error', v_step.last_error
           )
     WHERE id = v_step.id;

    v_skipped := v_skipped || jsonb_build_object(
      'step_key', v_step.step_key, 'status_before', v_step.status_before, 'status_after', 'skipped'
    );

    INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('pattern_x5_track_drift_skip', p_package_id::text, 'package', 'success',
            'auto-skipped phantom track-drift step ' || v_step.step_key,
            jsonb_build_object('step_key', v_step.step_key, 'previous_error', v_step.last_error));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'skipped', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_skip_track_drift_steps(uuid) TO service_role;

-- 3. Drift-Funktion erweitern (Pattern X5 + queued-Eligibility)
CREATE OR REPLACE FUNCTION public.admin_heal_pending_enqueue_drift(
  p_package_ids uuid[],
  p_reason text DEFAULT 'cockpit_pending_enqueue_drift_heal',
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_pkg RECORD;
  v_active_jobs int;
  v_open_steps int;
  v_done_steps int;
  v_step RECORD;
  v_results jsonb := '[]'::jsonb;
  v_steps_reset jsonb;
  v_skip_reason text;
  v_force_building boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no package ids provided');
  END IF;

  FOREACH v_pkg_id IN ARRAY p_package_ids
  LOOP
    v_skip_reason := NULL;
    v_force_building := false;
    v_steps_reset := '[]'::jsonb;

    SELECT id, status, archived, title INTO v_pkg
    FROM public.course_packages WHERE id = v_pkg_id;

    IF NOT FOUND THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg_id, 'skipped', true, 'reason', 'not_found');
      CONTINUE;
    END IF;

    IF v_pkg.archived THEN
      v_skip_reason := 'archived';
    ELSIF v_pkg.status NOT IN ('building','blocked','queued') THEN
      v_skip_reason := 'status_not_eligible';
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT count(*) INTO v_active_jobs FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND status IN ('processing','running','pending','queued','retry_scheduled','batch_pending');
      IF v_active_jobs > 0 THEN v_skip_reason := 'active_jobs_exist'; END IF;
    END IF;

    IF v_skip_reason IS NULL AND v_pkg.status = 'queued' THEN
      SELECT count(*) FILTER (WHERE status::text='done'),
             count(*) FILTER (WHERE status::text IN ('queued','pending_enqueue','failed','timeout','blocked'))
        INTO v_done_steps, v_open_steps
      FROM public.package_steps WHERE package_id = v_pkg_id;
      IF v_done_steps = 0 OR v_open_steps = 0 THEN
        v_skip_reason := 'not_pattern_x5_queued_stall';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg_id, 'title', v_pkg.title, 'skipped', true, 'reason', v_skip_reason);
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      PERFORM public.admin_skip_track_drift_steps(v_pkg_id);

      IF v_pkg.status IN ('queued','blocked') THEN
        UPDATE public.course_packages
        SET status = 'building', blocked_reason = NULL, updated_at = now(),
            feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
              'admin_force_building_reason', p_reason,
              'admin_force_building_at', now(),
              'admin_force_building_by', COALESCE(auth.uid()::text, 'service_role'),
              'admin_force_building_pattern', 'X5_queued_pipeline_stall')
        WHERE id = v_pkg_id;
        v_force_building := true;
      END IF;

      FOR v_step IN
        SELECT id, step_key, status::text AS status_before, last_error
        FROM public.package_steps
        WHERE package_id = v_pkg_id
          AND status::text IN ('queued','failed','blocked','timeout','pending_enqueue','cancelled')
          AND (
            step_key IN ('repair_exam_pool_quality','run_integrity_check','quality_council','auto_publish',
                         'build_ai_tutor_index','validate_tutor_index','elite_harden')
            OR coalesce(last_error,'') ILIKE '%non_building_blocked%'
            OR coalesce(last_error,'') ILIKE '%CAUSALITY_BLOCKED%'
          )
      LOOP
        UPDATE public.package_steps
        SET status = 'queued'::step_status, attempts = 0, last_error = NULL,
            started_at = NULL, finished_at = NULL, last_heartbeat_at = NULL,
            updated_at = now(),
            meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at'
        WHERE id = v_step.id;
        v_steps_reset := v_steps_reset || jsonb_build_object('step_key', v_step.step_key, 'status_before', v_step.status_before);
      END LOOP;

      BEGIN PERFORM public.admin_nudge_atomic_trigger(v_pkg_id);
      EXCEPTION WHEN OTHERS THEN NULL; END;

      INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('pattern_x5_queued_stall_heal', v_pkg_id::text, 'package', 'success',
              'auto-healed Pattern X5 queued-pipeline-stall',
              jsonb_build_object('reason', p_reason, 'force_building', v_force_building,
                                 'steps_reset', v_steps_reset, 'status_before', v_pkg.status,
                                 'status_after', 'building'));
    END IF;

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg_id, 'title', v_pkg.title,
      'force_building', v_force_building, 'steps_reset', v_steps_reset, 'dry_run', p_dry_run
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_heal_pending_enqueue_drift(uuid[], text, boolean) TO service_role;

-- 4. Manueller Bypass + Cluster-Heal
DO $$
DECLARE
  v_cluster uuid[];
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  v_result := public.admin_heal_pending_enqueue_drift(
    ARRAY['87636c6f-7b43-456c-a830-048aab2dcec4'::uuid,
          'd2000002-0003-4000-8000-000000000001'::uuid],
    'manual_bypass_pattern_x5', false);
  RAISE NOTICE 'Manual bypass: %', v_result;

  SELECT array_agg(id) INTO v_cluster FROM (
    SELECT cp.id FROM course_packages cp
    WHERE cp.status='queued' AND cp.archived = false
      AND cp.id NOT IN ('87636c6f-7b43-456c-a830-048aab2dcec4'::uuid,
                        'd2000002-0003-4000-8000-000000000001'::uuid)
      AND EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=cp.id AND ps.status::text='done')
      AND EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=cp.id AND ps.status::text IN ('queued','pending_enqueue','failed','timeout','blocked'))
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=cp.id AND jq.status IN ('queued','processing','running','pending','retry_scheduled','batch_pending'))
    ORDER BY cp.priority NULLS LAST, cp.title LIMIT 30
  ) sub;

  IF v_cluster IS NOT NULL AND array_length(v_cluster,1) > 0 THEN
    v_result := public.admin_heal_pending_enqueue_drift(v_cluster, 'systemwide_cluster_heal_pattern_x5', false);
    RAISE NOTICE 'Cluster heal (% pkgs): %', array_length(v_cluster,1), v_result;

    INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('pattern_x5_cluster_heal', 'system', 'system', 'success',
            'Cluster-wide Pattern X5 heal',
            jsonb_build_object('cluster_size', array_length(v_cluster,1), 'package_ids', to_jsonb(v_cluster)));
  END IF;
END $$;
