
-- Drop existing function with wrong return type first
DROP FUNCTION IF EXISTS public.recompute_package_progress(uuid);

-- Central recompute function (SSOT)
CREATE OR REPLACE FUNCTION public.recompute_package_progress(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total integer := 0;
  v_done  integer := 0;
  v_pct   integer := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status <> 'skipped'),
    COUNT(*) FILTER (WHERE status = 'done')
  INTO v_total, v_done
  FROM public.package_steps
  WHERE package_id = p_package_id;

  v_pct := CASE
    WHEN v_total > 0 THEN ROUND(v_done * 100.0 / v_total)
    ELSE 0
  END;

  UPDATE public.course_packages
  SET build_progress = v_pct,
      updated_at = now()
  WHERE id = p_package_id
    AND build_progress IS DISTINCT FROM v_pct;
END;
$$;

-- Hardened BEFORE guard with drift audit
CREATE OR REPLACE FUNCTION public.fn_guard_build_progress_drift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer := 0;
  v_done  integer := 0;
  v_pct   integer := 0;
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.build_progress IS DISTINCT FROM OLD.build_progress
  THEN
    SELECT
      COUNT(*) FILTER (WHERE status <> 'skipped'),
      COUNT(*) FILTER (WHERE status = 'done')
    INTO v_total, v_done
    FROM public.package_steps
    WHERE package_id = NEW.id;

    v_pct := CASE
      WHEN v_total > 0 THEN ROUND(v_done * 100.0 / v_total)
      ELSE 0
    END;

    -- Audit drift attempts
    IF NEW.build_progress IS DISTINCT FROM v_pct AND TG_OP = 'UPDATE' THEN
      INSERT INTO public.package_progress_drift_audit (
        package_id, attempted_value, corrected_value, operation
      ) VALUES (
        NEW.id, NEW.build_progress, v_pct, TG_OP
      );
    END IF;

    NEW.build_progress := v_pct;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_build_progress_drift ON public.course_packages;
CREATE TRIGGER trg_guard_build_progress_drift
  BEFORE INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_build_progress_drift();

-- package_steps trigger delegates to central function
CREATE OR REPLACE FUNCTION public.fn_sync_package_build_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recompute_package_progress(
    COALESCE(NEW.package_id, OLD.package_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_package_build_progress ON public.package_steps;
CREATE TRIGGER trg_sync_package_build_progress
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_package_build_progress();

NOTIFY pgrst, 'reload schema';
