
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role full access on autofix_runs" ON public.autofix_runs;

-- Only admins can read autofix_runs
CREATE POLICY "Admins can select autofix_runs"
ON public.autofix_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can insert autofix_runs
CREATE POLICY "Admins can insert autofix_runs"
ON public.autofix_runs
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can update autofix_runs
CREATE POLICY "Admins can update autofix_runs"
ON public.autofix_runs
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can delete autofix_runs
CREATE POLICY "Admins can delete autofix_runs"
ON public.autofix_runs
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
