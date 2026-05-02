-- Control-Lane Watchdog v1.5: Entkopplung admin_heal_pending_enqueue_drift
-- Root-Cause: UPDATE course_packages.status='building' triggert orchestrate-after-step,
-- der dieselben package_steps anfasst, die der Heiler im selben Command updated.
-- => "tuple already modified by trigger in this command".
--
-- Fix:
-- 1) Pro Paket: Kandidaten-Step-IDs ZUERST sammeln (kein UPDATE).
-- 2) course_packages.status erst danach updaten (Trigger laufen lassen).
-- 3) Step-für-Step in einzelnen Sub-Blöcken updaten — jeder Step in eigener
--    EXCEPTION-Boundary. Vor jedem UPDATE prüfen, ob der Step im aktuellen
--    Snapshot noch eligibel ist (Re-Read), sonst skip.
-- 4) Per-Step-Errors werden gesammelt, gesamter Heiler crasht nicht mehr.

CREATE OR REPLACE FUNCTION public.admin_heal_pending_enqueue_drift(
  p_package_ids uuid[],
  p_reason text DEFAULT 'cockpit_pending_enqueue_drift_heal'::text,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_pkg RECORD;
  v_active_jobs int;
  v_open_steps int;
  v_done_steps int;
  v_step_id uuid;
  v_step_key text;
  v_step_status_before text;
  v_results jsonb := '[]'::jsonb;
  v_steps_reset jsonb;
  v_step_errors jsonb;
  v_skip_reason text;
  v_force_building boolean;
  v_candidate_step_ids uuid[];
  v_candidate_step_keys text[];
  v_current_status text;
  v_step_err text;
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
    v_step_errors := '[]'::jsonb;
    v_candidate_step_ids := ARRAY[]::uuid[];
    v_candidate_step_keys := ARRAY[]::text[];

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
      -- Phase 0: Track-Drift entfernen (best-effort)
      BEGIN PERFORM public.admin_skip_track_drift_steps(v_pkg_id);
      EXCEPTION WHEN OTHERS THEN NULL; END;

      -- Phase 1: Kandidaten-Step-IDs ZUERST sammeln (kein UPDATE!)
      SELECT array_agg(id), array_agg(step_key::text)
        INTO v_candidate_step_ids, v_candidate_step_keys
      FROM public.package_steps
      WHERE package_id = v_pkg_id
        AND status::text IN ('queued','failed','blocked','timeout','pending_enqueue','cancelled')
        AND (
          step_key::text IN ('repair_exam_pool_quality','run_integrity_check','quality_council','auto_publish',
                             'build_ai_tutor_index','validate_tutor_index','elite_harden')
          OR coalesce(last_error,'') ILIKE '%non_building_blocked%'
          OR coalesce(last_error,'') ILIKE '%CAUSALITY_BLOCKED%'
        );

      -- Phase 2: course_packages.status updaten (Trigger laufen lassen)
      IF v_pkg.status IN ('queued','blocked') THEN
        BEGIN
          UPDATE public.course_packages
          SET status = 'building', blocked_reason = NULL, updated_at = now(),
              feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
                'admin_force_building_reason', p_reason,
                'admin_force_building_at', now(),
                'admin_force_building_by', COALESCE(auth.uid()::text, 'service_role'),
                'admin_force_building_pattern', 'X5_queued_pipeline_stall')
          WHERE id = v_pkg_id;
          v_force_building := true;
        EXCEPTION WHEN OTHERS THEN
          v_step_errors := v_step_errors || jsonb_build_object(
            'phase','course_packages_update','error', SQLERRM, 'sqlstate', SQLSTATE);
        END;
      END IF;

      -- Phase 3: Step-für-Step in eigener EXCEPTION-Boundary updaten.
      -- Vor jedem UPDATE Re-Read des aktuellen Status, weil Trigger aus Phase 2
      -- den Step bereits geändert haben könnten.
      IF v_candidate_step_ids IS NOT NULL THEN
        FOR i IN 1 .. array_length(v_candidate_step_ids, 1)
        LOOP
          v_step_id  := v_candidate_step_ids[i];
          v_step_key := v_candidate_step_keys[i];
          v_step_err := NULL;

          BEGIN
            -- Re-Read: nur updaten wenn Step jetzt noch in einem heilbaren Zustand ist
            SELECT status::text INTO v_current_status
            FROM public.package_steps
            WHERE id = v_step_id
            FOR UPDATE;  -- Row-Lock verhindert konkurrierende Trigger-Mutation während wir schreiben

            IF v_current_status IS NULL THEN
              v_step_errors := v_step_errors || jsonb_build_object(
                'step_id', v_step_id, 'step_key', v_step_key,
                'skipped', true, 'reason', 'step_disappeared');
              CONTINUE;
            END IF;

            IF v_current_status NOT IN ('queued','failed','blocked','timeout','pending_enqueue','cancelled') THEN
              -- Trigger hat den Step bereits in 'pending'/'processing'/'done' überführt → kein Heal nötig
              v_steps_reset := v_steps_reset || jsonb_build_object(
                'step_key', v_step_key, 'status_before', v_current_status,
                'skipped', true, 'reason', 'already_progressed_by_trigger');
              CONTINUE;
            END IF;

            UPDATE public.package_steps
            SET status = 'queued'::step_status,
                attempts = 0,
                last_error = NULL,
                started_at = NULL,
                finished_at = NULL,
                last_heartbeat_at = NULL,
                updated_at = now(),
                meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at'
                       || jsonb_build_object(
                            'healed_by','admin_heal_pending_enqueue_drift_v1_5',
                            'healed_at', now(),
                            'heal_reason', p_reason,
                            'status_before_heal', v_current_status)
            WHERE id = v_step_id;

            v_steps_reset := v_steps_reset || jsonb_build_object(
              'step_key', v_step_key, 'status_before', v_current_status, 'healed', true);

          EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_step_err = MESSAGE_TEXT;
            v_step_errors := v_step_errors || jsonb_build_object(
              'step_id', v_step_id, 'step_key', v_step_key,
              'error', v_step_err, 'sqlstate', SQLSTATE);
          END;
        END LOOP;
      END IF;

      -- Phase 4: Atomic-Nudge (best-effort, eigener Block)
      BEGIN PERFORM public.admin_nudge_atomic_trigger(v_pkg_id);
      EXCEPTION WHEN OTHERS THEN
        v_step_errors := v_step_errors || jsonb_build_object(
          'phase','admin_nudge_atomic_trigger','error', SQLERRM, 'sqlstate', SQLSTATE);
      END;

      -- Phase 5: Audit
      INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('pattern_x5_queued_stall_heal',
              v_pkg_id::text,
              'package',
              CASE WHEN jsonb_array_length(v_step_errors) = 0 THEN 'success' ELSE 'partial' END,
              CASE WHEN jsonb_array_length(v_step_errors) = 0
                   THEN 'auto-healed Pattern X5 queued-pipeline-stall (v1.5 decoupled)'
                   ELSE 'partial heal — see metadata.step_errors' END,
              jsonb_build_object(
                'reason', p_reason,
                'force_building', v_force_building,
                'steps_reset', v_steps_reset,
                'step_errors', v_step_errors,
                'status_before', v_pkg.status,
                'status_after', 'building',
                'version', 'v1_5_decoupled'));
    END IF;

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg_id, 'title', v_pkg.title,
      'force_building', v_force_building,
      'steps_reset', v_steps_reset,
      'step_errors', v_step_errors,
      'dry_run', p_dry_run
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results, 'version', 'v1_5_decoupled');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_heal_pending_enqueue_drift(uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_pending_enqueue_drift(uuid[], text, boolean) TO authenticated, service_role;