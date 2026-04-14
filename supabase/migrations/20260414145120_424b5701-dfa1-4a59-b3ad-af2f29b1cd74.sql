
-- 1. exam_questions: Remove broad policy that exposes correct_answer to all authenticated users
DROP POLICY IF EXISTS "Authenticated users can read approved questions" ON public.exam_questions;

-- 2. runner_health_log: Enable RLS and add admin+service_role policies
ALTER TABLE public.runner_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_runner_health"
  ON public.runner_health_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "service_role_all_runner_health"
  ON public.runner_health_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 3. system_audit_findings: Fix SELECT policy to admin-only
DROP POLICY IF EXISTS "admin_read_audit_findings" ON public.system_audit_findings;
CREATE POLICY "admin_read_audit_findings"
  ON public.system_audit_findings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. system_audit_actions: Fix SELECT policy to admin-only
DROP POLICY IF EXISTS "admin_read_audit_actions" ON public.system_audit_actions;
CREATE POLICY "admin_read_audit_actions"
  ON public.system_audit_actions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 5. system_audit_runs: Fix SELECT policy to admin-only
DROP POLICY IF EXISTS "admin_read_audit_runs" ON public.system_audit_runs;
CREATE POLICY "admin_read_audit_runs"
  ON public.system_audit_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 6. ai_cost_budgets: Remove overly permissive ALL policy
DROP POLICY IF EXISTS "Admins can manage cost budgets" ON public.ai_cost_budgets;

-- 7. performance_metrics: Remove overly permissive ALL policy
DROP POLICY IF EXISTS "Admins can view performance metrics" ON public.performance_metrics;

-- 8. system_optimization_reports: Remove overly permissive ALL policy
DROP POLICY IF EXISTS "Admins can manage optimization reports" ON public.system_optimization_reports;

-- 9. referral_invites: Remove overly broad read and update policies
DROP POLICY IF EXISTS "auth_read" ON public.referral_invites;
DROP POLICY IF EXISTS "auth_claim" ON public.referral_invites;

-- 10. ai_usage_log: Remove "Anyone can view" policy
DROP POLICY IF EXISTS "Anyone can view usage logs" ON public.ai_usage_log;

-- 11. course_track_overrides: Restrict INSERT and SELECT to admin-only
DROP POLICY IF EXISTS "Authenticated users can insert overrides" ON public.course_track_overrides;
DROP POLICY IF EXISTS "Authenticated users can view overrides" ON public.course_track_overrides;

CREATE POLICY "admin_insert_overrides"
  ON public.course_track_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin_read_overrides"
  ON public.course_track_overrides FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "service_role_all_overrides"
  ON public.course_track_overrides FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
