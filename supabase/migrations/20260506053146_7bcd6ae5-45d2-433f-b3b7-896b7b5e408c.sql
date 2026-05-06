
-- Add admin-only RLS policies to conversion_event_violations (currently RLS enabled, no policies)
CREATE POLICY "admins_select_conversion_event_violations"
ON public.conversion_event_violations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Inserts come from triggers/service role only; deny everyone else by omission.
COMMENT ON TABLE public.conversion_event_violations IS
  'Audit-only. Writes via SECURITY DEFINER triggers / service_role. Reads admin-only.';
