-- ============================================================
-- NON_BUILDING_PACKAGE Loop-Eliminierung (Cluster Cancel-Reasons)
-- ============================================================
-- Beobachtung (24h): 80 Cancels mit error='OPS_GUARD:NON_BUILDING_PACKAGE'
--   * 40× package_validate_blueprints für Paket 65a72513… (queued, nicht building)
--   * 40× package_promote_blueprint_variants für Paket ec0183bd… (queued, nicht building)
--   * Auslöser: pool_autosync-Cron alle 10min mit transition_source='auto_stamped_unknown'
--   * Bisheriger Flow: INSERT → Trigger setzt error → fn_guard_non_building_auto_cancel cancelt → silent
--
-- Lösung: Pre-Enqueue-Guard blockt INSERT direkt mit Exception (fail-fast).
--         Recovery-Lane und explizite Repair-Jobs bleiben erlaubt.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_guard_non_building_enqueue_loop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_status text;
  v_whitelisted boolean;
BEGIN
  -- Scope: nur die loop-anfälligen Job-Types
  IF NEW.job_type NOT IN ('package_validate_blueprints', 'package_promote_blueprint_variants') THEN
    RETURN NEW;
  END IF;

  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Recovery-Lane und explizite Repair-/Adoption-Modi sind erlaubt (echte Heilung)
  IF COALESCE(NEW.lane, '') = 'recovery'
     OR COALESCE((NEW.payload->>'is_repair')::boolean, false) = true
     OR COALESCE(NEW.payload->>'mode', '') ILIKE 'admin_repair%'
     OR COALESCE(NEW.payload->>'source', '') ILIKE 'admin_%'
  THEN
    RETURN NEW;
  END IF;

  -- Whitelist via job_type_policies respektieren
  SELECT COALESCE(can_run_when_not_building, false) OR COALESCE(exempt_from_auto_cancel, false)
    INTO v_whitelisted
  FROM public.job_type_policies
  WHERE job_type = NEW.job_type;

  IF COALESCE(v_whitelisted, false) THEN
    RETURN NEW;
  END IF;

  -- Paket-Status prüfen
  SELECT status INTO v_pkg_status
  FROM public.course_packages
  WHERE id = NEW.package_id;

  IF v_pkg_status IS NULL THEN
    -- Paket existiert nicht: andere Trigger handhaben das
    RETURN NEW;
  END IF;

  IF v_pkg_status <> 'building' THEN
    -- Hartes Block: kein Loop-INSERT
    RAISE EXCEPTION 'NON_BUILDING_ENQUEUE_BLOCKED: % skipped — package % is %, not building (loop-prevention)',
      NEW.job_type, NEW.package_id, v_pkg_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_non_building_enqueue_loop ON public.job_queue;
CREATE TRIGGER trg_guard_non_building_enqueue_loop
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_non_building_enqueue_loop();

COMMENT ON FUNCTION public.fn_guard_non_building_enqueue_loop() IS
  'Pre-Enqueue-Guard: blockt package_validate_blueprints / package_promote_blueprint_variants wenn Paket nicht in building. Erlaubt recovery-lane und admin_repair-Modi. Eliminiert NON_BUILDING_PACKAGE auto-cancel Loop (~80 cancels/24h).';