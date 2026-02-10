
-- Fix search path for is_admin_user function
CREATE OR REPLACE FUNCTION public.is_admin_user(check_uid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = check_uid AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
