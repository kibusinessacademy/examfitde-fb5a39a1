CREATE OR REPLACE FUNCTION public.get_distinct_step_keys()
RETURNS TABLE(step_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ps.step_key
  FROM package_steps ps
  ORDER BY ps.step_key;
$$;