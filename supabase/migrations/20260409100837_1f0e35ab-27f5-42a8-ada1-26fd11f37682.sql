
-- ============================================================
-- P0: Kanonische fn_package_publish_readiness
-- Einzige SSOT-Funktion für Publish-Entscheidungen
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
  v_track text;
BEGIN
  -- 1. Package basics
  SELECT cp.id, cp.status, cp.council_approved, cp.integrity_passed,
         cp.build_progress, cp.blocked_reason, cp.admin_hold,
         COALESCE(cp.pipeline_mode, 'standard') AS track,
         cp.council_approved_at, cp.published_at
  INTO v_pkg
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'reasons', ARRAY['PACKAGE_NOT_FOUND'], 'package_id', p_package_id);
  END IF;

  v_track := v_pkg.track;

  -- 2. Admin hold check
  IF COALESCE(v_pkg.admin_hold, false) THEN
    v_reasons := array_append(v_reasons, 'ADMIN_HOLD');
  END IF;

  -- 3. Blocked check
  IF v_pkg.status = 'blocked' THEN
    v_reasons := array_append(v_reasons, 'STATUS_BLOCKED:' || COALESCE(v_pkg.blocked_reason, 'no_reason'));
  END IF;

  -- 4. Integrity check
  IF NOT COALESCE(v_pkg.integrity_passed, false) THEN
    v_reasons := array_append(v_reasons, 'INTEGRITY_NOT_PASSED');
  END IF;

  -- 5. Council sessions — the SSOT truth
  SELECT count(*),
         count(*) FILTER (WHERE cs.status IN ('pending', 'processing')),
         count(*) FILTER (WHERE cs.status = 'completed' AND cs.decision = 'approve'),
         count(*) FILTER (WHERE cs.status NOT IN ('completed', 'cancelled', 'skipped'))
  INTO v_total_sessions, v_pending_sessions, v_approved_sessions, v_open_sessions
  FROM council_sessions cs
  WHERE cs.package_id = p_package_id;

  -- Council not approved if open sessions exist
  IF v_open_sessions > 0 THEN
    v_reasons := array_append(v_reasons, 'COUNCIL_SESSIONS_OPEN:' || v_open_sessions);
  END IF;

  -- Council not approved if no approve decisions
  IF v_total_sessions > 0 AND v_approved_sessions = 0 THEN
    v_reasons := array_append(v_reasons, 'COUNCIL_NO_APPROVAL');
  END IF;

  -- Council flag inconsistency
  IF NOT COALESCE(v_pkg.council_approved, false) AND v_open_sessions = 0 AND v_approved_sessions > 0 THEN
    v_reasons := array_append(v_reasons, 'COUNCIL_APPROVED_DRIFT:flag_false_but_sessions_approved');
  END IF;

  -- 6. Mandatory step check (all non-skipped steps must be done)
  SELECT count(*)
  INTO v_mandatory_steps_not_done
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key <> 'auto_publish'
    AND ps.status NOT IN ('done', 'skipped');

  IF v_mandatory_steps_not_done > 0 THEN
    v_reasons := array_append(v_reasons, 'STEPS_NOT_DONE:' || v_mandatory_steps_not_done);
  END IF;

  -- Build step summary
  SELECT jsonb_object_agg(ps.step_key, ps.status)
  INTO v_step_summary
  FROM package_steps ps
  WHERE ps.package_id = p_package_id;

  -- 7. Ghost auto_publish detection
  SELECT * INTO v_auto_publish_step
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_publish';

  IF FOUND THEN
    IF v_auto_publish_step.status IN ('processing', 'done') AND v_auto_publish_step.started_at IS NULL THEN
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
    'track', v_track,
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

-- ============================================================
-- P1: Ghost-Step-Hard-Guard für auto_publish
-- Blockiert auto_publish processing-Start ohne Vorbedingungen
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
  -- Only guard auto_publish step
  IF NEW.step_key <> 'auto_publish' THEN RETURN NEW; END IF;

  -- Guard transitions TO processing (materialization)
  IF NEW.status = 'processing' AND OLD.status IS DISTINCT FROM 'processing' THEN
    v_readiness := fn_package_publish_readiness(NEW.package_id);
    v_reasons := ARRAY(SELECT jsonb_array_elements_text(v_readiness->'reasons'));

    -- Filter out reasons that are about auto_publish itself
    v_reasons := ARRAY(
      SELECT r FROM unnest(v_reasons) r 
      WHERE r NOT LIKE 'GHOST_AUTO_PUBLISH%' 
        AND r NOT LIKE 'STEPS_NOT_DONE%'
    );

    IF array_length(v_reasons, 1) IS NOT NULL THEN
      RAISE WARNING '[GUARD] auto_publish processing blocked for package %: %', 
        NEW.package_id, array_to_string(v_reasons, ', ');
      -- Don't RAISE EXCEPTION — revert to queued with reason
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

  RETURN NEW;
END;
$$;

-- Create trigger (before the existing ghost step guard)
DROP TRIGGER IF EXISTS trg_guard_auto_publish_preconditions ON public.package_steps;
CREATE TRIGGER trg_guard_auto_publish_preconditions
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_auto_publish_preconditions();

-- ============================================================
-- P1: Council-Guard auf Session-Finalität härten
-- council_approved=true NUR wenn alle Sessions terminal + min 1 approve
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_guard_council_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_sessions int;
  v_approved_sessions int;
  v_total_sessions int;
BEGIN
  IF NEW.council_approved = true AND (OLD.council_approved IS DISTINCT FROM true) THEN
    -- Count session states
    SELECT count(*),
           count(*) FILTER (WHERE cs.status NOT IN ('completed', 'cancelled', 'skipped')),
           count(*) FILTER (WHERE cs.status = 'completed' AND cs.decision = 'approve')
    INTO v_total_sessions, v_open_sessions, v_approved_sessions
    FROM council_sessions cs
    WHERE cs.package_id = NEW.id;

    -- Block if open sessions exist
    IF v_open_sessions > 0 THEN
      RAISE WARNING '[COUNCIL_GUARD] Blocked council_approved=true for package % — % sessions still open (pending/processing)', 
        NEW.id, v_open_sessions;
      NEW.council_approved := false;
      NEW.council_approved_at := NULL;
      
      INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id)
      VALUES (
        'Council Approval Blocked',
        format('Package %s: council_approved blocked — %s sessions still open.', NEW.id::text, v_open_sessions),
        'ops', 'warn', 'package', NEW.id
      );
      RETURN NEW;
    END IF;

    -- Block if no approve decisions exist (but sessions do)
    IF v_total_sessions > 0 AND v_approved_sessions = 0 THEN
      RAISE WARNING '[COUNCIL_GUARD] Blocked council_approved=true for package % — no approved sessions (total=%)', 
        NEW.id, v_total_sessions;
      NEW.council_approved := false;
      NEW.council_approved_at := NULL;
      
      INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id)
      VALUES (
        'Council Approval Blocked — No Approvals',
        format('Package %s: council_approved blocked — %s sessions, 0 approvals.', NEW.id::text, v_total_sessions),
        'ops', 'warn', 'package', NEW.id
      );
      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- P2: Deterministic Blocking statt Silent Revert
-- guard_building_published_drift → mit Audit statt stiller Änderung
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_building_published_drift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If published_at is set and status is still 'building', normalize with audit
  IF NEW.published_at IS NOT NULL AND NEW.status = 'building' THEN
    NEW.status := 'published';
    NEW.updated_at := now();
    
    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id)
    VALUES (
      'Package Status Auto-Normalized (building→published)',
      format('Package %s had published_at set but status=building. Normalized to published with audit.', NEW.id::text),
      'ops', 'info', 'package', NEW.id
    );
    
    INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
    VALUES (
      'auto_normalize_building_to_published',
      'publish_governance',
      ARRAY[NEW.id::text],
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', 'published',
        'trigger', 'guard_building_published_drift',
        'reason', 'published_at was set but status was building'
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================
-- P2: Idempotenter Drift-Reconciler
-- Heilt Ghost-Steps, Council-Drift, QGF-Bounces
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
  -- 1. Ghost auto_publish steps (started_at NULL but status processing/done)
  FOR v_pkg IN
    SELECT ps.package_id, ps.step_key, ps.status, ps.started_at, ps.finished_at
    FROM package_steps ps
    WHERE ps.step_key = 'auto_publish'
      AND ps.status IN ('processing', 'done')
      AND ps.started_at IS NULL
  LOOP
    IF NOT p_dry_run THEN
      UPDATE package_steps 
      SET status = 'queued', started_at = NULL, finished_at = NULL,
          last_error = 'GHOST_HEALED:started_at was null in status ' || v_pkg.status,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'ghost_healed_at', now()::text,
            'ghost_healed_from', v_pkg.status
          )
      WHERE package_id = v_pkg.package_id AND step_key = 'auto_publish';
    END IF;
    v_healed := array_append(v_healed, jsonb_build_object(
      'type', 'ghost_auto_publish', 'package_id', v_pkg.package_id, 
      'old_status', v_pkg.status, 'action', CASE WHEN p_dry_run THEN 'would_heal' ELSE 'healed' END
    ));
  END LOOP;

  -- 2. Council-approved drift (flag=false but all sessions terminal + approved)
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
      AND NOT COALESCE(cp.admin_hold, false)
  LOOP
    v_readiness := fn_package_publish_readiness(v_pkg.package_id);
    v_reasons := ARRAY(SELECT jsonb_array_elements_text(v_readiness->'reasons'));
    
    -- Remove reasons that are about current status being blocked/qgf
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

  -- 4. auto_publish step done but package not published (reverse drift)
  FOR v_pkg IN
    SELECT ps.package_id, cp.status AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.step_key = 'auto_publish'
      AND ps.status = 'done'
      AND cp.status <> 'published'
  LOOP
    IF NOT p_dry_run THEN
      UPDATE package_steps
      SET status = 'failed', 
          last_error = 'DRIFT_HEALED:step was done but package status is ' || v_pkg.pkg_status
      WHERE package_id = v_pkg.package_id AND step_key = 'auto_publish';
    END IF;
    v_healed := array_append(v_healed, jsonb_build_object(
      'type', 'auto_publish_done_but_not_published', 'package_id', v_pkg.package_id,
      'pkg_status', v_pkg.pkg_status,
      'action', CASE WHEN p_dry_run THEN 'would_heal' ELSE 'healed' END
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'healed_count', array_length(v_healed, 1),
    'healed', v_healed,
    'evaluated_at', now()
  );
END;
$$;

-- ============================================================
-- Grant execute permissions
-- ============================================================

GRANT EXECUTE ON FUNCTION public.fn_package_publish_readiness(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_publish_governance_drift(boolean) TO service_role;
