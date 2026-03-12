
-- Fix step-job drift: set started_at and attempts to satisfy ghost guard

-- 1. Industriemechaniker validate_learning_content
UPDATE public.package_steps
SET status = 'done', started_at = now() - interval '1 minute', finished_at = now(), 
    last_error = NULL, attempts = 1
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'validate_learning_content'
  AND status != 'done';

-- 2. Elektroniker validate_learning_content  
UPDATE public.package_steps
SET status = 'done', started_at = now() - interval '1 minute', finished_at = now(),
    last_error = NULL, attempts = 1
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND step_key = 'validate_learning_content'
  AND status != 'done';

-- 3. Clear stale sequence guard errors
UPDATE public.package_steps
SET last_error = NULL
WHERE package_id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '9c1b3734-bb25-4986-baef-5bb1c20a212c')
  AND last_error LIKE 'Sequence guard:%'
  AND status = 'queued';

-- 4. Sync build_progress
UPDATE public.course_packages cp
SET build_progress = sub.pct, updated_at = now()
FROM (
  SELECT ps.package_id,
         ROUND(COUNT(*) FILTER (WHERE ps.status IN ('done','skipped')) * 100.0 / GREATEST(COUNT(*), 1))::int AS pct
  FROM public.package_steps ps
  JOIN public.course_packages c ON c.id = ps.package_id
  WHERE c.status = 'building'
  GROUP BY ps.package_id
) sub
WHERE cp.id = sub.package_id;

-- 5. Create trigger to keep build_progress synced
CREATE OR REPLACE FUNCTION public.fn_sync_package_build_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_done int;
  v_pct int;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status IN ('done', 'skipped'))
  INTO v_total, v_done
  FROM public.package_steps
  WHERE package_id = NEW.package_id;

  v_pct := CASE WHEN v_total > 0 THEN ROUND(v_done * 100.0 / v_total) ELSE 0 END;

  UPDATE public.course_packages
  SET build_progress = v_pct, updated_at = now()
  WHERE id = NEW.package_id
    AND build_progress IS DISTINCT FROM v_pct;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_build_progress ON public.package_steps;
CREATE TRIGGER trg_sync_build_progress
  AFTER INSERT OR UPDATE OF status ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_package_build_progress();
