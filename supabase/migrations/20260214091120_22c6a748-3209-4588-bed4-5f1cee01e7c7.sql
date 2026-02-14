
-- 1) recover_stuck_packages: auto-releases packages stuck at step 0
CREATE OR REPLACE FUNCTION public.recover_stuck_packages(
  p_age_minutes int DEFAULT 15,
  p_limit int DEFAULT 10
)
RETURNS TABLE(package_id uuid, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
BEGIN
  FOR v_pkg IN
    SELECT cp.id
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND COALESCE(cp.current_step, 0) = 0
      AND (cp.step_status_json IS NULL OR cp.step_status_json = '{}'::jsonb)
      AND cp.updated_at < now() - make_interval(mins => p_age_minutes)
    ORDER BY cp.updated_at ASC
    LIMIT p_limit
  LOOP
    -- Fail the package
    UPDATE course_packages
      SET status = 'failed',
          updated_at = now()
    WHERE id = v_pkg.id
      AND status = 'building';

    -- Release its slot
    DELETE FROM pipeline_active_packages
    WHERE pipeline_active_packages.package_id = v_pkg.id;

    package_id := v_pkg.id;
    action := 'failed_and_slot_released';
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stuck_packages(int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.recover_stuck_packages(int, int) TO service_role;

-- 2) release_stale_slots: frees slots with expired heartbeats
CREATE OR REPLACE FUNCTION public.release_stale_slots(
  p_age_minutes int DEFAULT 10
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM pipeline_active_packages
  WHERE COALESCE(heartbeat_at, claimed_at) < now() - make_interval(mins => p_age_minutes);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_slots(int) FROM public;
GRANT EXECUTE ON FUNCTION public.release_stale_slots(int) TO service_role;
