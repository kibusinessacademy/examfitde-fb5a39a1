-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;

-- Create a secure policy that only allows users to view their own profile or admins to view all
CREATE POLICY "Users can view own profile or admins all" ON profiles
  FOR SELECT
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));