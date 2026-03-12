
-- 1. Trigger: Clear integrity_passed/council_approved when their steps are reset
CREATE OR REPLACE FUNCTION public.fn_clear_stale_package_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When run_integrity_check is reset away from 'done', clear integrity_passed
  IF NEW.step_key = 'run_integrity_check' AND NEW.status IN ('queued','running','failed') 
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE course_packages
    SET integrity_passed = false, updated_at = now()
    WHERE id = NEW.package_id AND integrity_passed = true;
  END IF;

  -- When quality_council is reset away from 'done', clear council_approved
  IF NEW.step_key = 'quality_council' AND NEW.status IN ('queued','running','failed')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE course_packages
    SET council_approved = false, updated_at = now()
    WHERE id = NEW.package_id AND council_approved = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_stale_package_flags ON public.package_steps;
CREATE TRIGGER trg_clear_stale_package_flags
  AFTER UPDATE OF status ON public.package_steps
  FOR EACH ROW
  WHEN (NEW.status IN ('queued','running','failed'))
  EXECUTE FUNCTION public.fn_clear_stale_package_flags();

-- 2. Fix existing stale flags: clear integrity/council if their steps are not done
UPDATE course_packages cp
SET 
  integrity_passed = CASE 
    WHEN EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id = cp.id AND ps.step_key = 'run_integrity_check' AND ps.status = 'done') THEN cp.integrity_passed
    ELSE false
  END,
  council_approved = CASE
    WHEN EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id = cp.id AND ps.step_key = 'quality_council' AND ps.status = 'done') THEN cp.council_approved
    ELSE false
  END,
  updated_at = now()
WHERE cp.status = 'building'
  AND (
    (cp.integrity_passed = true AND NOT EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id = cp.id AND ps.step_key = 'run_integrity_check' AND ps.status = 'done'))
    OR 
    (cp.council_approved = true AND NOT EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id = cp.id AND ps.step_key = 'quality_council' AND ps.status = 'done'))
  );

-- 3. Fix build_progress drift: resync all building packages
UPDATE course_packages cp
SET build_progress = sub.pct, updated_at = now()
FROM (
  SELECT ps.package_id,
    ROUND((count(*) FILTER (WHERE ps.status IN ('done','skipped'))::numeric / NULLIF(count(*),0)) * 100) AS pct
  FROM package_steps ps
  GROUP BY ps.package_id
) sub
WHERE cp.id = sub.package_id
  AND cp.status = 'building'
  AND cp.build_progress IS DISTINCT FROM sub.pct;
