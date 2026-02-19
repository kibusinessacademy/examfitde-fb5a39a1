
-- Fix: Allow authenticated admin users to READ llm_cost_events
CREATE POLICY "Admins can read llm_cost_events"
ON public.llm_cost_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);

-- Fix: Allow authenticated admin users to READ ai_cost_budgets (currently only auth.uid() IS NOT NULL)
-- Already has a permissive policy, but let's also ensure kpi_daily_rollup is readable
-- Check if kpi_daily_rollup has admin read policy
CREATE POLICY "Admins can read kpi_daily_rollup"
ON public.kpi_daily_rollup
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);
