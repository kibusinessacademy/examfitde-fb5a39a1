CREATE OR REPLACE FUNCTION public.admin_smart_heal_bulk(
  p_package_ids uuid[],
  p_caller_id uuid DEFAULT NULL::uuid,
  p_action text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_pkg_id uuid;
  v_row record;
  v_action text;
  v_executed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_needs_modal jsonb := '[]'::jsonb;
  v_needs_confirmation jsonb := '[]'::jsonb;
  v_recheck_class text;
  v_recheck_status text;
  v_recheck_blocked text;
  v_recheck_published boolean;
  v_recheck_deficiencies text[];
  v_recheck_active_repair int;
  v_recheck_active_reconcile int;
  v_recent_reconcile int;
BEGIN
  IF array_length(p_package_ids, 1) IS NULL OR array_length(p_package_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'executed', '[]'::jsonb, 'skipped', '[]'::jsonb,
      'needs_modal', '[]'::jsonb, 'needs_confirmation', '[]'::jsonb
    );
  END IF;

  IF array_length(p_package_ids, 1) > 25 THEN
    RAISE EXCEPTION 'bulk_limit_exceeded: max 25 packages per call (got %)', array_length(p_package_ids, 1);
  END IF;

  -- Override allowlist unchanged (only bulk_reconcile can be forced)
  IF p_action IS NOT NULL AND p_action NOT IN ('bulk_reconcile') THEN
    RAISE EXCEPTION 'unsupported_override_action: % (only bulk_reconcile allowed)', p_action;
  END IF;

  FOREACH v_pkg_id IN ARRAY p_package_ids LOOP
    SELECT * INTO v_row FROM public.v_admin_heal_cockpit WHERE package_id = v_pkg_id;
    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('package_id', v_pkg_id, 'reason', 'not_found');
      CONTINUE;
    END IF;

    v_action := COALESCE(p_action, v_row.recommended_action);

    IF v_action IN ('guided_recovery') THEN
      v_needs_modal := v_needs_modal || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action,
        'reasons', to_jsonb(v_row.recommended_action_reasons)
      );
      CONTINUE;
    END IF;

    IF v_action IN ('hard_rebuild','mark_content_gap') THEN
      v_needs_confirmation := v_needs_confirmation || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action,
        'reasons', to_jsonb(v_row.recommended_action_reasons)
      );
      CONTINUE;
    END IF;

    IF v_action = 'force_publish' THEN
      SELECT rc.release_class, cp.status, cp.blocked_reason, cp.is_published, rc.deficiency_codes
        INTO v_recheck_class, v_recheck_status, v_recheck_blocked, v_recheck_published, v_recheck_deficiencies
      FROM public.course_packages cp
      LEFT JOIN public.v_package_release_classification rc ON rc.package_id = cp.id
      WHERE cp.id = v_pkg_id;

      SELECT COUNT(*) INTO v_recheck_active_repair
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND status IN ('pending','queued','processing')
        AND job_type LIKE 'package_repair_%';

      IF v_recheck_class IS DISTINCT FROM 'release_ok'
         OR v_recheck_status = 'published'
         OR v_recheck_published = true
         OR v_recheck_blocked IS NOT NULL
         OR (v_recheck_deficiencies IS NOT NULL AND array_length(v_recheck_deficiencies,1) > 0)
         OR v_recheck_active_repair > 0
      THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'state_changed'
        );
        CONTINUE;
      END IF;

      BEGIN
        PERFORM public.admin_force_steps_done(
          v_pkg_id, NULL::text[], 'smart_heal_bulk:force_publish', false, true
        );
        v_executed := v_executed || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'result', 'published_via_admin_force_steps_done'
        );
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action,
          'reason', 'admin_force_steps_done_failed', 'error', SQLERRM
        );
      END;
      CONTINUE;
    END IF;

    -- NEU v8.5: needs_repair_dispatch — re-check + enqueue reconcile
    IF v_action = 'needs_repair_dispatch' THEN
      SELECT rc.release_class, cp.blocked_reason
        INTO v_recheck_class, v_recheck_blocked
      FROM public.course_packages cp
      LEFT JOIN public.v_package_release_classification rc ON rc.package_id = cp.id
      WHERE cp.id = v_pkg_id;

      SELECT COUNT(*) INTO v_recheck_active_repair
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND status IN ('pending','queued','processing')
        AND (job_type LIKE 'package_repair_%' OR job_type = 'package_reconcile_artifacts');

      IF v_recheck_class IS DISTINCT FROM 'release_block'
         OR v_recheck_blocked IS DISTINCT FROM 'pipeline_repair_required'
      THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'state_changed'
        );
        CONTINUE;
      END IF;

      IF v_recheck_active_repair > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'already_running'
        );
        CONTINUE;
      END IF;

      SELECT COUNT(*) INTO v_recent_reconcile
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND job_type = 'package_reconcile_artifacts'
        AND created_at > now() - interval '10 minutes';

      IF v_recent_reconcile > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'cooldown_skip'
        );
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO public.job_queue (job_type, package_id, status, payload, created_at)
        VALUES (
          'package_reconcile_artifacts', v_pkg_id, 'pending',
          jsonb_build_object('source','smart_heal_bulk:needs_repair_dispatch','caller_id', v_caller),
          now()
        );
        v_executed := v_executed || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'result', 'enqueued'
        );
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action,
          'reason', 'enqueue_failed', 'error', SQLERRM
        );
      END;
      CONTINUE;
    END IF;

    IF v_action = 'bulk_reconcile' THEN
      SELECT COUNT(*) INTO v_recheck_active_reconcile
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND status IN ('pending','queued','processing')
        AND job_type = 'package_reconcile_artifacts';

      IF v_recheck_active_reconcile > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'already_running'
        );
        CONTINUE;
      END IF;

      SELECT COUNT(*) INTO v_recent_reconcile
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND job_type = 'package_reconcile_artifacts'
        AND created_at > now() - interval '10 minutes';

      IF v_recent_reconcile > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'cooldown_skip'
        );
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO public.job_queue (job_type, package_id, status, payload, created_at)
        VALUES (
          'package_reconcile_artifacts', v_pkg_id, 'pending',
          jsonb_build_object('source','smart_heal_bulk','caller_id', v_caller),
          now()
        );
        v_executed := v_executed || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'result', 'enqueued'
        );
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action,
          'reason', 'enqueue_failed', 'error', SQLERRM
        );
      END;
      CONTINUE;
    END IF;

    v_skipped := v_skipped || jsonb_build_object(
      'package_id', v_pkg_id, 'action', v_action, 'reason', 'no_auto_action'
    );
  END LOOP;

  INSERT INTO public.admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES (
    'smart_heal_bulk',
    'heal_cockpit',
    p_package_ids,
    jsonb_build_object(
      'requested_action', p_action,
      'executed_count', jsonb_array_length(v_executed),
      'skipped_count', jsonb_array_length(v_skipped),
      'needs_modal_count', jsonb_array_length(v_needs_modal),
      'needs_confirmation_count', jsonb_array_length(v_needs_confirmation),
      'executed', v_executed,
      'skipped', v_skipped
    ),
    v_caller
  );

  RETURN jsonb_build_object(
    'ok', true,
    'executed', v_executed,
    'skipped', v_skipped,
    'needs_modal', v_needs_modal,
    'needs_confirmation', v_needs_confirmation
  );
END;
$function$;