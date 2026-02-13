
-- =============================================
-- LAYER 1: SECURITY FREEZE - Remove all USING(true) on public role
-- =============================================

-- 1A) "Service role full access" policies on roles={public} → restrict to service_role only
-- These were accidentally granted to ALL roles including anon

-- admin_patch_plans
DROP POLICY IF EXISTS "Service role full access on admin_patch_plans" ON public.admin_patch_plans;
CREATE POLICY "service_role_admin_patch_plans" ON public.admin_patch_plans FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_admin_patch_plans" ON public.admin_patch_plans FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- blueprint_versions
DROP POLICY IF EXISTS "Service role full access on blueprint_versions" ON public.blueprint_versions;
CREATE POLICY "service_role_blueprint_versions" ON public.blueprint_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_blueprint_versions" ON public.blueprint_versions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- course_health_snapshots
DROP POLICY IF EXISTS "Service role can manage health snapshots" ON public.course_health_snapshots;
CREATE POLICY "service_role_course_health_snapshots" ON public.course_health_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_course_health_snapshots" ON public.course_health_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- disallowed_keywords
DROP POLICY IF EXISTS "Admins can manage disallowed keywords" ON public.disallowed_keywords;
CREATE POLICY "service_role_disallowed_keywords" ON public.disallowed_keywords FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_disallowed_keywords" ON public.disallowed_keywords FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- marketing tables (6 tables)
DROP POLICY IF EXISTS "Admin full access marketing_assets" ON public.marketing_assets;
CREATE POLICY "service_role_marketing_assets" ON public.marketing_assets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_marketing_assets" ON public.marketing_assets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin full access marketing_budget_requests" ON public.marketing_budget_requests;
CREATE POLICY "service_role_marketing_budget_requests" ON public.marketing_budget_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_marketing_budget_requests" ON public.marketing_budget_requests FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin full access marketing_campaigns" ON public.marketing_campaigns;
CREATE POLICY "service_role_marketing_campaigns" ON public.marketing_campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_marketing_campaigns" ON public.marketing_campaigns FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin full access marketing_experiments" ON public.marketing_experiments;
CREATE POLICY "service_role_marketing_experiments" ON public.marketing_experiments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_marketing_experiments" ON public.marketing_experiments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin full access marketing_learnings" ON public.marketing_learnings;
CREATE POLICY "service_role_marketing_learnings" ON public.marketing_learnings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_marketing_learnings" ON public.marketing_learnings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin full access marketing_plans" ON public.marketing_plans;
CREATE POLICY "service_role_marketing_plans" ON public.marketing_plans FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_marketing_plans" ON public.marketing_plans FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- post_validation_results
DROP POLICY IF EXISTS "Service role can manage validation results" ON public.post_validation_results;
CREATE POLICY "service_role_post_validation_results" ON public.post_validation_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_post_validation_results" ON public.post_validation_results FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- quality_gate_results
DROP POLICY IF EXISTS "Admins can manage quality gate results" ON public.quality_gate_results;
CREATE POLICY "service_role_quality_gate_results" ON public.quality_gate_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_quality_gate_results" ON public.quality_gate_results FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- seo tables
DROP POLICY IF EXISTS "Service role full access seo_documents" ON public.seo_documents;
CREATE POLICY "service_role_seo_documents" ON public.seo_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_seo_documents" ON public.seo_documents FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Service role full access seo_generation_jobs" ON public.seo_generation_jobs;
CREATE POLICY "service_role_seo_generation_jobs" ON public.seo_generation_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_seo_generation_jobs" ON public.seo_generation_jobs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Service role full access seo_templates" ON public.seo_templates;
CREATE POLICY "service_role_seo_templates" ON public.seo_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_seo_templates" ON public.seo_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- tech_council_findings
DROP POLICY IF EXISTS "Service role full access on tech_council_findings" ON public.tech_council_findings;
CREATE POLICY "service_role_tech_council_findings" ON public.tech_council_findings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin_read_tech_council_findings" ON public.tech_council_findings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 1B) INSERT with true on roles={public} → restrict to service_role
DROP POLICY IF EXISTS "Service insert ai_generations" ON public.ai_generations;
CREATE POLICY "service_role_insert_ai_generations" ON public.ai_generations FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert ai_quality_gates" ON public.ai_quality_gates;
CREATE POLICY "service_role_insert_ai_quality_gates" ON public.ai_quality_gates FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "System can insert usage logs" ON public.ai_usage_log;
CREATE POLICY "service_role_insert_ai_usage_log" ON public.ai_usage_log FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert ai_validations" ON public.ai_validations;
CREATE POLICY "service_role_insert_ai_validations" ON public.ai_validations FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service can insert ledger" ON public.ledger_entries;
CREATE POLICY "service_role_insert_ledger_entries" ON public.ledger_entries FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service can insert ops snapshots" ON public.ops_health_snapshots;
CREATE POLICY "service_role_insert_ops_health_snapshots" ON public.ops_health_snapshots FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "System can insert AI responses" ON public.support_ai_responses;
CREATE POLICY "service_role_insert_support_ai_responses" ON public.support_ai_responses FOR INSERT TO service_role WITH CHECK (true);

-- 1C) SELECT with true on roles={public} that should be admin-only
DROP POLICY IF EXISTS "Admin read auto_heal_log" ON public.auto_heal_log;
CREATE POLICY "admin_read_auto_heal_log" ON public.auto_heal_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_auto_heal_log" ON public.auto_heal_log FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service can read auto_heal_policies" ON public.auto_heal_policies;
CREATE POLICY "admin_read_auto_heal_policies" ON public.auto_heal_policies FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_auto_heal_policies" ON public.auto_heal_policies FOR ALL TO service_role USING (true) WITH CHECK (true);

-- qc_run_results: was roles={authenticated} with true
DROP POLICY IF EXISTS "QC results readable by authenticated users" ON public.qc_run_results;
CREATE POLICY "admin_read_qc_run_results" ON public.qc_run_results FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "QC results insertable by service role" ON public.qc_run_results;
CREATE POLICY "service_role_insert_qc_run_results" ON public.qc_run_results FOR INSERT TO service_role WITH CHECK (true);

-- =============================================
-- LAYER 2: Fix search_path in SECURITY DEFINER function
-- =============================================
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
    INSERT INTO public.course_package_build_steps(package_id, step_key, status, log)
    VALUES (p_package_id, s, 'pending', jsonb_build_object('note','queued'))
    ON CONFLICT (package_id, step_key) DO NOTHING;
  END LOOP;
END $$;

-- =============================================
-- LAYER 3: Views → security_invoker = on
-- =============================================
ALTER VIEW public.affiliate_referrals_safe SET (security_invoker = on);
ALTER VIEW public.ai_cost_overview SET (security_invoker = on);
ALTER VIEW public.ai_worker_health SET (security_invoker = on);
ALTER VIEW public.azav_dashboard_stats SET (security_invoker = on);
ALTER VIEW public.blueprint_questions_view SET (security_invoker = on);
ALTER VIEW public.curriculum_products_overview SET (security_invoker = on);
ALTER VIEW public.exam_questions_safe SET (security_invoker = on);
ALTER VIEW public.job_deadletter SET (security_invoker = on);
ALTER VIEW public.job_failure_analysis SET (security_invoker = on);
ALTER VIEW public.job_health_kpis SET (security_invoker = on);
ALTER VIEW public.lesson_qc_view SET (security_invoker = on);
ALTER VIEW public.license_seats_safe SET (security_invoker = on);
ALTER VIEW public.ops_blocked_packages SET (security_invoker = on);
ALTER VIEW public.ops_content_factory SET (security_invoker = on);
ALTER VIEW public.ops_cost_summary SET (security_invoker = on);
ALTER VIEW public.ops_heal_effectiveness SET (security_invoker = on);
ALTER VIEW public.ops_health_summary SET (security_invoker = on);
ALTER VIEW public.ops_job_summary SET (security_invoker = on);
ALTER VIEW public.ops_seeding_summary SET (security_invoker = on);
ALTER VIEW public.v_exam_questions_approved SET (security_invoker = on);
ALTER VIEW public.v_growth_actions_approved SET (security_invoker = on);
ALTER VIEW public.v_qa_last_runs SET (security_invoker = on);
ALTER VIEW public.v_qa_open_findings SET (security_invoker = on);
ALTER VIEW public.v_qa_risk_acceptances SET (security_invoker = on);
ALTER VIEW public.v_revenue_daily SET (security_invoker = on);
ALTER VIEW public.v_vat_monthly SET (security_invoker = on);

-- =============================================
-- LAYER 4: Security Audit Trail table
-- =============================================
CREATE TABLE IF NOT EXISTS public.security_audit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type text NOT NULL DEFAULT 'full',
  policies_with_using_true int NOT NULL DEFAULT 0,
  functions_without_search_path int NOT NULL DEFAULT 0,
  views_without_invoker int NOT NULL DEFAULT 0,
  tables_without_rls int NOT NULL DEFAULT 0,
  total_issues int NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text DEFAULT 'system'
);

ALTER TABLE public.security_audit_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_security_audit" ON public.security_audit_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_security_audit" ON public.security_audit_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- LAYER 5: Platform Risk Score table
-- =============================================
CREATE TABLE IF NOT EXISTS public.platform_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_date date NOT NULL DEFAULT CURRENT_DATE,
  overall_score numeric(5,2) NOT NULL DEFAULT 0,
  security_score numeric(5,2) NOT NULL DEFAULT 0,
  quality_score numeric(5,2) NOT NULL DEFAULT 0,
  compliance_score numeric(5,2) NOT NULL DEFAULT 0,
  operational_score numeric(5,2) NOT NULL DEFAULT 0,
  dimensions jsonb NOT NULL DEFAULT '{}',
  recommendations text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(score_date)
);

ALTER TABLE public.platform_risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_risk_scores" ON public.platform_risk_scores FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_risk_scores" ON public.platform_risk_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================
-- LAYER 6: B2B Tenant Release Gate
-- =============================================
CREATE TABLE IF NOT EXISTS public.tenant_release_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  gate_type text NOT NULL DEFAULT 'b2b_onboarding',
  status text NOT NULL DEFAULT 'pending',
  checks_passed jsonb NOT NULL DEFAULT '{}',
  checks_failed jsonb NOT NULL DEFAULT '{}',
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_release_gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_manage_tenant_gates" ON public.tenant_release_gates FOR ALL TO authenticated 
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_role_tenant_gates" ON public.tenant_release_gates FOR ALL TO service_role USING (true) WITH CHECK (true);
