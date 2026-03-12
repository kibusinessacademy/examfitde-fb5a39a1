
-- ═══════════════════════════════════════════════════════════════
-- FIX 1: Release stale auto-heal leases blocking 3 packages
-- ═══════════════════════════════════════════════════════════════
DELETE FROM public.package_leases
WHERE runner_id LIKE 'auto-heal%'
  AND package_id IN (
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  );

-- ═══════════════════════════════════════════════════════════════
-- FIX 2: Create trigger to sync build_progress & current_step
-- from package_steps whenever a step status changes
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_sync_package_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg uuid;
  v_done int;
  v_total int;
  v_progress int;
  v_current_step int;
BEGIN
  v_pkg := COALESCE(NEW.package_id, OLD.package_id);

  SELECT count(*) FILTER (WHERE status IN ('done', 'skipped')),
         count(*)
  INTO v_done, v_total
  FROM public.package_steps
  WHERE package_id = v_pkg;

  IF v_total > 0 THEN
    v_progress := round((v_done::numeric / v_total) * 100);
  ELSE
    v_progress := 0;
  END IF;

  -- current_step = index of first non-done step (0-based)
  SELECT COALESCE(MIN(rn) - 1, v_total - 1)
  INTO v_current_step
  FROM (
    SELECT status, row_number() OVER (ORDER BY created_at) AS rn
    FROM public.package_steps
    WHERE package_id = v_pkg
  ) sub
  WHERE status NOT IN ('done', 'skipped');

  UPDATE public.course_packages
  SET build_progress = v_progress,
      current_step = COALESCE(v_current_step, 0),
      last_progress_at = CASE
        WHEN NEW.status IN ('done', 'running') THEN now()
        ELSE last_progress_at
      END,
      updated_at = now()
  WHERE id = v_pkg;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop if exists and recreate
DROP TRIGGER IF EXISTS trg_sync_package_progress ON public.package_steps;
CREATE TRIGGER trg_sync_package_progress
  AFTER INSERT OR UPDATE OF status ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_package_progress();

-- ═══════════════════════════════════════════════════════════════
-- FIX 3: Immediately sync all building packages now
-- ═══════════════════════════════════════════════════════════════
WITH step_stats AS (
  SELECT
    ps.package_id,
    count(*) FILTER (WHERE ps.status IN ('done', 'skipped')) AS done_count,
    count(*) AS total_count
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE cp.status = 'building'
  GROUP BY ps.package_id
)
UPDATE public.course_packages cp
SET build_progress = CASE WHEN ss.total_count > 0 THEN round((ss.done_count::numeric / ss.total_count) * 100) ELSE 0 END,
    updated_at = now()
FROM step_stats ss
WHERE cp.id = ss.package_id;

-- Also rebuild step_status_json for all building packages
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.course_packages WHERE status = 'building'
  LOOP
    PERFORM public.rebuild_package_step_status_json(r.id);
  END LOOP;
END;
$$;
