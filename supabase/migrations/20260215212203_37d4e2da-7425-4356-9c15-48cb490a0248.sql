
-- Fix: init_course_package_steps must insert into the REAL table (package_steps), not the view
CREATE OR REPLACE FUNCTION public.init_course_package_steps(p_package_id uuid, p_steps text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY p_steps LOOP
    INSERT INTO public.package_steps(package_id, step_key, status, meta)
    VALUES (p_package_id, s, 'pending', jsonb_build_object('note','queued'))
    ON CONFLICT (package_id, step_key) DO NOTHING;
  END LOOP;
END;
$$;
