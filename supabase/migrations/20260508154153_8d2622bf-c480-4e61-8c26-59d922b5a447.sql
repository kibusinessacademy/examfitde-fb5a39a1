-- Tighten RLS on internal compliance/AI-governance tables: only admins may read.
DROP POLICY IF EXISTS "Admins can read audits" ON public.compliance_audits;
CREATE POLICY "Admins can read audits"
  ON public.compliance_audits
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can read kpis" ON public.compliance_kpi_snapshots;
CREATE POLICY "Admins can read kpis"
  ON public.compliance_kpi_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can read ai_gov" ON public.ai_governance_reviews;
CREATE POLICY "Admins can read ai_gov"
  ON public.ai_governance_reviews
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can read frameworks" ON public.compliance_frameworks;
CREATE POLICY "Admins can read frameworks"
  ON public.compliance_frameworks
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Remove the anon-enumeration policy on quiz_attempts; anonymous users have no
-- reliable identity to scope to and the existing policy returned every anon row.
-- Anonymous self-review (if needed) must go through a server-side RPC that
-- accepts the anonymous_id and returns only the matching row.
DROP POLICY IF EXISTS "quiz_attempts_anon_select_anon_rows" ON public.quiz_attempts;