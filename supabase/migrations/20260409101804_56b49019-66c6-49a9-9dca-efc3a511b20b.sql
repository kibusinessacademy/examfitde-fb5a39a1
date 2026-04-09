
-- ============================================================
-- FIX 1+3: auto_publish preconditions guard
-- - STEPS_NOT_DONE NOT filtered (was the most dangerous bug)
-- - Trigger on BEFORE INSERT OR UPDATE (not just UPDATE)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_guard_auto_publish_preconditions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_readiness jsonb;
  v_reasons text[];
BEGIN
  IF NEW.step_key <> 'auto_publish' THEN RETURN NEW; END IF;

  -- Guard transitions TO running (on both INSERT and UPDATE)
  IF NEW.status = 'running' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'running') THEN
    v_readiness := fn_package_publish_readiness(NEW.package_id);
    v_reasons := ARRAY(SELECT jsonb_array_elements_text(v_readiness->'reasons'));

    -- Only filter GHOST_AUTO_PUBLISH (self-referential) — NOT STEPS_NOT_DONE
    v_reasons := ARRAY(
      SELECT r FROM unnest(v_reasons) r 
      WHERE r NOT LIKE 'GHOST_AUTO_PUBLISH%'
    );

    IF array_length(v_reasons, 1) IS NOT NULL THEN
      RAISE WARNING '[GUARD] auto_publish running blocked for package %: %', 
        NEW.package_id, array_to_string(v_reasons, ', ');
      NEW.status := 'queued';
      NEW.started_at := NULL;
      NEW.last_error := 'PRECONDITION_NOT_MET: ' || array_to_string(v_reasons, ', ');
      NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
        'guard', 'fn_guard_auto_publish_preconditions',
        'blocked_reasons', v_reasons,
        'blocked_at', now()::text
      );
    END IF;
  END IF;

  -- Also guard INSERT with done status (prevents ghost insertion)
  IF TG_OP = 'INSERT' AND NEW.step_key = 'auto_publish' AND NEW.status IN ('done', 'running') THEN
    IF NEW.started_at IS NULL THEN
      RAISE WARNING '[GUARD] auto_publish ghost insert blocked for package %', NEW.package_id;
      NEW.status := 'queued';
      NEW.started_at := NULL;
      NEW.finished_at := NULL;
      NEW.last_error := 'GHOST_INSERT_BLOCKED: cannot insert auto_publish as done/running without started_at';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- FIX 4: Trigger on BEFORE INSERT OR UPDATE (not just UPDATE)
DROP TRIGGER IF EXISTS trg_guard_auto_publish_preconditions ON public.package_steps;
CREATE TRIGGER trg_guard_auto_publish_preconditions
  BEFORE INSERT OR UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_auto_publish_preconditions();

-- ============================================================
-- FIX 5: Explicitly rebind council guard trigger
-- ============================================================

DROP TRIGGER IF EXISTS trg_guard_council_approved ON public.course_packages;
CREATE TRIGGER trg_guard_council_approved
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_council_approved();

-- ============================================================
-- FIX 7: Reconciler rule 4 — readiness-aware before failing
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_reconcile_publish_governance_drift(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed jsonb[] := '{}';
  v_pkg record;
  v_readiness jsonb;
  v_reasons text[];
BEGIN
  -- 1. Ghost auto_publish steps (started_at NULL but status running/done)
  FOR v_pkg IN
    SELECT ps.package_id, ps.step_key, ps.status::text AS status_text, ps.started_at, ps.finished_at
    FROM package_steps ps
    WHERE ps.step_key = 'auto_publish'
      AND ps.status IN ('running', 'done')
      AND ps.started_at IS NULL
  LOOP
    IF NOT p_dry_run THEN
      UPDATE package_steps 
      SET status = 'queued', started_at = NULL, finished_at = NULL,
          last_error = 'GHOST_HEALED:started_at was null in status ' || v_pkg.status_text,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'ghost_healed_at', now()::text,
            'ghost_healed_from', v_pkg.status_text
          )
      WHERE package_id = v_pkg.package_id AND step_key = 'auto_publish';
    END IF;
    v_healed := array_append(v_healed, jsonb_build_object(
      'type', 'ghost_auto_publish', 'package_id', v_pkg.package_id, 
      'old_status', v_pkg.status_text, 'action', CASE WHEN p_dry_run THEN 'would_heal' ELSE 'healed' END
    ));
  END LOOP;

  -- 2. Council-approved drift
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.council_approved, cp.status
    FROM course_packages cp
    WHERE cp.council_approved = false
      AND cp.status IN ('building', 'quality_gate_failed')
      AND NOT EXISTS (
        SELECT 1 FROM council_sessions cs 
        WHERE cs.package_id = cp.id 
          AND cs.status NOT IN ('completed', 'cancelled', 'skipped')
      )
      AND EXISTS (
        SELECT 1 FROM council_sessions cs 
        WHERE cs.package_id = cp.id 
          AND cs.status = 'completed' AND cs.decision = 'approve'
      )
  LOOP
    IF NOT p_dry_run THEN
      UPDATE course_packages 
      SET council_approved = true, council_approved_at = now(), updated_at = now()
      WHERE id = v_pkg.package_id;
      
      UPDATE package_steps
      SET status = 'done', finished_at = COALESCE(finished_at, now()),
          started_at = COALESCE(started_at, now()),
          attempts = GREATEST(attempts, 1)
      WHERE package_id = v_pkg.package_id AND step_key = 'quality_council' AND status <> 'done';
    END IF;
    v_healed := array_append(v_healed, jsonb_build_object(
      'type', 'council_approved_drift', 'package_id', v_pkg.package_id,
      'action', CASE WHEN p_dry_run THEN 'would_heal' ELSE 'healed' END
    ));
  END LOOP;

  -- 3. QGF packages that are actually publish-ready
  FOR v_pkg IN
    SELECT cp.id AS package_id
    FROM course_packages cp
    WHERE cp.status = 'quality_gate_failed'
      AND cp.council_approved = true
      AND cp.integrity_passed = true
  LOOP
    v_readiness := fn_package_publish_readiness(v_pkg.package_id);
    v_reasons := ARRAY(SELECT jsonb_array_elements_text(v_readiness->'reasons'));
    
    -- For QGF check: filter out status-based reasons (circular)
    v_reasons := ARRAY(
      SELECT r FROM unnest(v_reasons) r 
      WHERE r NOT LIKE 'STATUS_BLOCKED%'
    );
    
    IF array_length(v_reasons, 1) IS NULL THEN
      IF NOT p_dry_run THEN
        UPDATE course_packages 
        SET status = 'building', blocked_reason = NULL, updated_at = now()
        WHERE id = v_pkg.package_id;
        
        INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
        VALUES (
          'reconcile_qgf_to_building',
          'publish_governance',
          ARRAY[v_pkg.package_id::text],
          jsonb_build_object('readiness', v_readiness)
        );
      END IF;
      v_healed := array_append(v_healed, jsonb_build_object(
        'type', 'qgf_bounce_healed', 'package_id', v_pkg.package_id,
        'action', CASE WHEN p_dry_run THEN 'would_heal' ELSE 'healed' END
      ));
    END IF;
  END LOOP;

  -- 4. auto_publish step done but package not published — READINESS-AWARE
  FOR v_pkg IN
    SELECT ps.package_id, cp.status AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.step_key = 'auto_publish'
      AND ps.status = 'done'
      AND cp.status <> 'published'
  LOOP
    -- Check if package is actually publish-ready
    v_readiness := fn_package_publish_readiness(v_pkg.package_id);
    v_reasons := ARRAY(SELECT jsonb_array_elements_text(v_readiness->'reasons'));
    -- Filter self-referential reasons
    v_reasons := ARRAY(
      SELECT r FROM unnest(v_reasons) r 
      WHERE r NOT LIKE 'STATUS_BLOCKED%' AND r NOT LIKE 'GHOST_AUTO_PUBLISH%'
    );

    IF array_length(v_reasons, 1) IS NULL THEN
      -- Readiness is true → normalize package to published
      IF NOT p_dry_run THEN
        UPDATE course_packages
        SET status = 'published', published_at = COALESCE(published_at, now()), updated_at = now()
        WHERE id = v_pkg.package_id;
        
        INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
        VALUES (
          'reconcile_auto_publish_normalize',
          'publish_governance',
          ARRAY[v_pkg.package_id::text],
          jsonb_build_object('readiness', v_readiness, 'action', 'normalized_to_published')
        );
      END IF;
      v_healed := array_append(v_healed, jsonb_build_object(
        'type', 'auto_publish_done_normalized_to_published', 'package_id', v_pkg.package_id,
        'action', CASE WHEN p_dry_run THEN 'would_normalize' ELSE 'normalized' END
      ));
    ELSE
      -- Readiness is false → step was prematurely marked done
      IF NOT p_dry_run THEN
        UPDATE package_steps
        SET status = 'failed', 
            last_error = 'DRIFT_HEALED:step done but readiness false — ' || array_to_string(v_reasons, ', ')
        WHERE package_id = v_pkg.package_id AND step_key = 'auto_publish';
      END IF;
      v_healed := array_append(v_healed, jsonb_build_object(
        'type', 'auto_publish_done_but_not_ready', 'package_id', v_pkg.package_id,
        'pkg_status', v_pkg.pkg_status,
        'reasons', v_reasons,
        'action', CASE WHEN p_dry_run THEN 'would_fail' ELSE 'failed' END
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'healed_count', COALESCE(array_length(v_healed, 1), 0),
    'healed', v_healed,
    'evaluated_at', now()
  );
END;
$$;

-- ============================================================
-- FIX 8: fn_package_publish_readiness — status is informational, 
-- not a primary blocker. Only block on 'blocked' status if 
-- there's a meaningful blocked_reason.
-- ============================================================

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

  -- Admin hold (only if explicitly set as blocked_reason)
  IF v_pkg.blocked_reason = 'admin_hold' THEN
    v_reasons := array_append(v_reasons, 'ADMIN_HOLD');
  END IF;

  -- Status 'blocked' WITH a meaningful reason is a real blocker
  -- Status 'quality_gate_failed' is NOT a primary blocker — the Reconciler handles it
  IF v_pkg.status = 'blocked' AND v_pkg.blocked_reason IS NOT NULL 
     AND v_pkg.blocked_reason <> 'admin_hold' THEN
    v_reasons := array_append(v_reasons, 'STATUS_BLOCKED:' || v_pkg.blocked_reason);
  END IF;

  -- Integrity: fachliche Wahrheit
  IF NOT COALESCE(v_pkg.integrity_passed, false) THEN
    v_reasons := array_append(v_reasons, 'INTEGRITY_NOT_PASSED');
  END IF;

  -- Council sessions: SSOT truth
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

  -- Mandatory steps: all non-skipped, non-auto_publish must be done
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

  -- Ghost auto_publish detection
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
