
-- ═══════════════════════════════════════════════════════════════════════
-- ANTI-DRIFT GUARD: Prevent any direct build_progress writes from 
-- overriding the trigger-calculated value from package_steps.
-- This BEFORE UPDATE trigger intercepts any UPDATE that sets build_progress
-- and replaces it with the actual computed value from package_steps.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_guard_build_progress_drift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_done int;
  v_pct int;
BEGIN
  -- Only intercept if build_progress is being changed
  IF NEW.build_progress IS DISTINCT FROM OLD.build_progress THEN
    -- Compute real progress from package_steps (SSOT)
    SELECT 
      COUNT(*) FILTER (WHERE status != 'skipped'),
      COUNT(*) FILTER (WHERE status = 'done')
    INTO v_total, v_done
    FROM public.package_steps
    WHERE package_id = NEW.id;

    v_pct := CASE WHEN v_total > 0 THEN ROUND(v_done * 100.0 / v_total) ELSE 0 END;

    -- Override whatever was written with the SSOT value
    NEW.build_progress := v_pct;
  END IF;

  RETURN NEW;
END;
$function$;

-- Drop if exists then create
DROP TRIGGER IF EXISTS trg_guard_build_progress_drift ON public.course_packages;

CREATE TRIGGER trg_guard_build_progress_drift
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_build_progress_drift();

-- ═══════════════════════════════════════════════════════════════════════
-- RECONCILIATION: Fix all currently drifted packages in one shot
-- ═══════════════════════════════════════════════════════════════════════

WITH step_agg AS (
  SELECT
    ps.package_id,
    COUNT(*) FILTER (WHERE ps.status != 'skipped') AS total_functional,
    COUNT(*) FILTER (WHERE ps.status = 'done') AS done_count
  FROM public.package_steps ps
  GROUP BY ps.package_id
)
UPDATE public.course_packages cp
SET 
  build_progress = CASE WHEN sa.total_functional > 0 
    THEN ROUND(sa.done_count * 100.0 / sa.total_functional) 
    ELSE 0 END,
  updated_at = now()
FROM step_agg sa
WHERE cp.id = sa.package_id
  AND cp.build_progress IS DISTINCT FROM (
    CASE WHEN sa.total_functional > 0 
      THEN ROUND(sa.done_count * 100.0 / sa.total_functional) 
      ELSE 0 END
  );

NOTIFY pgrst, 'reload schema';
