
-- ═══════════════════════════════════════════════════════════════
-- PATCH A: step_status_json live-sync from package_steps
-- ═══════════════════════════════════════════════════════════════

-- 1) Helper RPC: rebuild step_status_json from package_steps (SSOT)
CREATE OR REPLACE FUNCTION public.rebuild_package_step_status_json(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_json jsonb;
BEGIN
  SELECT jsonb_object_agg(ps.step_key, ps.status ORDER BY ps.step_key)
  INTO v_json
  FROM public.package_steps ps
  WHERE ps.package_id = p_package_id;

  UPDATE public.course_packages
  SET step_status_json = COALESCE(v_json, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_package_step_status_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_package_step_status_json(uuid) TO service_role;

-- 2) Trigger function: auto-rebuild on any package_steps change
CREATE OR REPLACE FUNCTION public.fn_rebuild_step_status_json_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_pkg uuid;
BEGIN
  v_pkg := COALESCE(NEW.package_id, OLD.package_id);
  PERFORM public.rebuild_package_step_status_json(v_pkg);
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_rebuild_step_status_json_on_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rebuild_step_status_json_on_change() TO service_role;

-- 3) Wire the trigger
DROP TRIGGER IF EXISTS trg_rebuild_step_status_json ON public.package_steps;

CREATE TRIGGER trg_rebuild_step_status_json
AFTER INSERT OR UPDATE OR DELETE
ON public.package_steps
FOR EACH ROW
EXECUTE FUNCTION public.fn_rebuild_step_status_json_on_change();


-- ═══════════════════════════════════════════════════════════════
-- PATCH B: Harden ghost-guard — block done/failed when started_at IS NULL
--          regardless of attempts count
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_ghost_step_finalization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only guard transitions TO 'done' or 'failed'
  IF NEW.status NOT IN ('done', 'failed') THEN RETURN NEW; END IF;
  -- Allow metadata updates on already-finalized steps
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Block if step was never started (started_at IS NULL)
  -- Exception: steps explicitly approved via exception_approved
  IF NEW.started_at IS NULL AND NOT COALESCE(NEW.exception_approved, false) THEN
    RAISE EXCEPTION 'GHOST_FINALIZATION_BLOCKED: step "%" cannot be marked "%" — started_at IS NULL, attempts=%, package=%',
      NEW.step_key, NEW.status, NEW.attempts, NEW.package_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create trigger (same name, same position)
DROP TRIGGER IF EXISTS trg_guard_ghost_step_finalization ON public.package_steps;

CREATE TRIGGER trg_guard_ghost_step_finalization
BEFORE UPDATE OF status
ON public.package_steps
FOR EACH ROW
EXECUTE FUNCTION public.guard_ghost_step_finalization();
