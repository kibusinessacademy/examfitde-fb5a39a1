
-- Fix: step_status_json sync check with proper cast
CREATE OR REPLACE FUNCTION public.check_step_status_json_sync()
RETURNS TABLE(package_id uuid, step_key text, actual_status text, json_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ps.package_id, ps.step_key, ps.status::text AS actual_status,
    cp.step_status_json->>ps.step_key AS json_status
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE cp.status IN ('building', 'done')
    AND cp.step_status_json IS NOT NULL
    AND (cp.step_status_json->>ps.step_key) IS DISTINCT FROM ps.status::text
  LIMIT 50;
$$;
