
DROP FUNCTION IF EXISTS public.get_admin_auto_heal_queue(text);
DROP FUNCTION IF EXISTS public.get_admin_auto_heal_queue;

CREATE OR REPLACE FUNCTION public.get_admin_auto_heal_queue(p_status text DEFAULT NULL)
RETURNS SETOF admin_course_auto_heal_queue
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM admin_course_auto_heal_queue
  WHERE (p_status IS NULL OR status = p_status)
  ORDER BY created_at DESC
  LIMIT 100;
$$;
