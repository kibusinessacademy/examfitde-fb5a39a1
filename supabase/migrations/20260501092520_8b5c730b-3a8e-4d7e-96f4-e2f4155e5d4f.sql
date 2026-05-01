-- =======================================================================
-- Pricing-Integrity Hard Gate v1
-- =======================================================================
-- 1. fn_package_pricing_ready(uuid) → jsonb  (SSOT für Pricing-Readiness)
-- 2. fn_package_publish_readiness erweitert um PRICING_* Reasons
-- 3. trg_guard_publish_requires_pricing on course_packages
--    (blockt UPDATE status -> 'published' ohne aktiven Stripe-Preis)
-- =======================================================================

-- 1) Pricing-Readiness SSOT
CREATE OR REPLACE FUNCTION public.fn_package_pricing_ready(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg          record;
  v_active_count int := 0;
  v_with_stripe  int := 0;
  v_reasons      text[] := '{}';
BEGIN
  SELECT cp.id, cp.product_id, cp.status
    INTO v_pkg
    FROM course_packages cp
   WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'reasons', ARRAY['PACKAGE_NOT_FOUND']);
  END IF;

  IF v_pkg.product_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'PRICING_PRODUCT_ID_MISSING');
    RETURN jsonb_build_object(
      'ready', false,
      'reasons', v_reasons,
      'product_id', NULL,
      'active_prices', 0,
      'prices_with_stripe', 0
    );
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE pp.active = true),
    COUNT(*) FILTER (WHERE pp.active = true AND pp.stripe_price_id IS NOT NULL)
    INTO v_active_count, v_with_stripe
    FROM product_prices pp
   WHERE pp.product_id = v_pkg.product_id;

  IF v_active_count = 0 THEN
    v_reasons := array_append(v_reasons, 'PRICING_NO_ACTIVE_PRICE');
  END IF;

  IF v_with_stripe = 0 THEN
    v_reasons := array_append(v_reasons, 'PRICING_STRIPE_PRICE_ID_MISSING');
  END IF;

  RETURN jsonb_build_object(
    'ready', array_length(v_reasons, 1) IS NULL,
    'reasons', COALESCE(v_reasons, '{}'),
    'product_id', v_pkg.product_id,
    'active_prices', v_active_count,
    'prices_with_stripe', v_with_stripe
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_package_pricing_ready(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_package_pricing_ready(uuid) TO service_role;

-- 2) Publish-Readiness erweitern: PRICING-Reasons aufnehmen
CREATE OR REPLACE FUNCTION public.fn_package_publish_readiness(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_pricing jsonb;
  v_pricing_reasons text[];
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

  IF v_pkg.status = 'blocked' AND v_pkg.blocked_reason IS NOT NULL
     AND v_pkg.blocked_reason <> 'admin_hold' THEN
    v_reasons := array_append(v_reasons, 'STATUS_BLOCKED:' || v_pkg.blocked_reason);
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

  -- Pricing-Hard-Gate (NEW)
  v_pricing := fn_package_pricing_ready(p_package_id);
  v_pricing_reasons := ARRAY(SELECT jsonb_array_elements_text(v_pricing->'reasons'));
  IF array_length(v_pricing_reasons, 1) IS NOT NULL THEN
    v_reasons := v_reasons || v_pricing_reasons;
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
    'pricing', v_pricing,
    'build_progress', COALESCE(v_pkg.build_progress, 0),
    'evaluated_at', now()
  );
END;
$function$;

-- 3) Hard-Trigger: Publish ohne Stripe-Preis blockieren
CREATE OR REPLACE FUNCTION public.fn_guard_publish_requires_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pricing       jsonb;
  v_reasons       text[];
BEGIN
  -- Nur prüfen wenn nach 'published' gewechselt wird
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN

    -- Bypass für Replication / Restore
    IF current_setting('session_replication_role', true) = 'replica' THEN
      RETURN NEW;
    END IF;

    v_pricing := fn_package_pricing_ready(NEW.id);
    v_reasons := ARRAY(SELECT jsonb_array_elements_text(v_pricing->'reasons'));

    IF array_length(v_reasons, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'PRICING_HARD_GATE_BLOCKED package=% reasons=%',
        NEW.id, array_to_string(v_reasons, ', ')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_publish_requires_pricing ON public.course_packages;
CREATE TRIGGER trg_guard_publish_requires_pricing
BEFORE INSERT OR UPDATE OF status ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_publish_requires_pricing();

-- Smoke-Probe
SELECT
  jsonb_pretty(fn_package_pricing_ready(id)) AS pricing,
  status
FROM course_packages
WHERE status = 'published'
LIMIT 1;
