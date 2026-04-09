
CREATE OR REPLACE FUNCTION public.fn_package_publish_readiness(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_reasons text[] := '{}';
  v_step_summary jsonb := '{}'::jsonb;
  v_open_sessions int := 0;
  v_pending_sessions int := 0;
  v_approved_sessions int := 0;
  v_total_sessions int := 0;
  v_mandatory_steps_not_done int := 0;
  v_auto_publish_step record;
  v_has_ghost_auto_publish boolean := false;
BEGIN
  SELECT cp.id, cp.status, cp.council_approved, cp.integrity_passed,
         cp.build_progress, cp.blocked_reason,
         COALESCE(cp.pipeline_mode::text, 'factory') AS track,
         cp.council_approved_at, cp.published_at
  INTO v_pkg
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'reasons', ARRAY['PACKAGE_NOT_FOUND'], 'package_id', p_package_id);
  END IF;

  IF v_pkg.blocked_reason = 'admin_hold' THEN
    v_reasons := array_append(v_reasons, 'ADMIN_HOLD');
  END IF;

  IF v_pkg.status = 'blocked' THEN
    v_reasons := array_append(v_reasons, 'STATUS_BLOCKED:' || COALESCE(v_pkg.blocked_reason, 'no_reason'));
  END IF;

  IF NOT COALESCE(v_pkg.integrity_passed, false) THEN
    v_reasons := array_append(v_reasons, 'INTEGRITY_NOT_PASSED');
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE cs.status IN ('pending', 'processing')),
         count(*) FILTER (WHERE cs.status = 'completed' AND cs.decision = 'approve'),
         count(*) FILTER (WHERE cs.status NOT IN ('completed', 'cancelled', 'skipped'))
  INTO v_total_sessions, v_pending_sessions, v_approved_sessions, v_open_sessions
  FROM council_sessions cs
  WHERE cs.package_id = p_package_id;

  IF v_open_sessions > 0 THEN
    v_reasons := array_append(v_reasons, 'COUNCIL_SESSIONS_OPEN:' || v_open_sessions);
  END IF;

  IF v_total_sessions > 0 AND v_approved_sessions = 0 THEN
    v_reasons := array_append(v_reasons, 'COUNCIL_NO_APPROVAL');
  END IF;

  IF NOT COALESCE(v_pkg.council_approved, false) AND v_open_sessions = 0 AND v_approved_sessions > 0 THEN
    v_reasons := array_append(v_reasons, 'COUNCIL_APPROVED_DRIFT:flag_false_but_sessions_approved');
  END IF;

  SELECT count(*)
  INTO v_mandatory_steps_not_done
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key <> 'auto_publish'
    AND ps.status NOT IN ('done', 'skipped');

  IF v_mandatory_steps_not_done > 0 THEN
    v_reasons := array_append(v_reasons, 'STEPS_NOT_DONE:' || v_mandatory_steps_not_done);
  END IF;

  SELECT jsonb_object_agg(ps.step_key, ps.status)
  INTO v_step_summary
  FROM package_steps ps
  WHERE ps.package_id = p_package_id;

  SELECT * INTO v_auto_publish_step
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_publish';

  IF FOUND THEN
    IF v_auto_publish_step.status IN ('running', 'done') AND v_auto_publish_step.started_at IS NULL THEN
      v_has_ghost_auto_publish := true;
      v_reasons := array_append(v_reasons, 'GHOST_AUTO_PUBLISH:started_at_null');
    END IF;
    IF v_auto_publish_step.status = 'done' AND v_auto_publish_step.finished_at IS NULL THEN
      v_has_ghost_auto_publish := true;
      v_reasons := array_append(v_reasons, 'GHOST_AUTO_PUBLISH:finished_at_null');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ready', array_length(v_reasons, 1) IS NULL,
    'reasons', v_reasons,
    'package_id', p_package_id,
    'status', v_pkg.status,
    'track', v_pkg.track,
    'integrity_passed', COALESCE(v_pkg.integrity_passed, false),
    'council_approved', COALESCE(v_pkg.council_approved, false),
    'council_sessions', jsonb_build_object(
      'total', v_total_sessions,
      'open', v_open_sessions,
      'pending', v_pending_sessions,
      'approved', v_approved_sessions
    ),
    'steps_not_done', v_mandatory_steps_not_done,
    'step_summary', COALESCE(v_step_summary, '{}'::jsonb),
    'has_ghost_auto_publish', v_has_ghost_auto_publish,
    'build_progress', COALESCE(v_pkg.build_progress, 0),
    'evaluated_at', now()
  );
END;
$$;
