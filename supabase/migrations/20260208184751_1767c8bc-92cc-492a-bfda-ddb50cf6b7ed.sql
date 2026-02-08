-- =====================================================
-- Security Fix: Add security_invoker=true to views
-- This ensures views respect the caller's RLS policies
-- =====================================================

-- 1. Fix ai_cost_overview view
DROP VIEW IF EXISTS public.ai_cost_overview;
CREATE VIEW public.ai_cost_overview
WITH (security_invoker=true) AS
SELECT 
    month,
    budget_eur,
    spent_eur,
    alert_threshold,
    alert_sent_at,
    round(((spent_eur / NULLIF(budget_eur, (0)::numeric)) * (100)::numeric), 1) AS usage_percent,
    (budget_eur - spent_eur) AS remaining_eur,
    ( SELECT count(*) AS count
           FROM ai_usage_log l
          WHERE (date_trunc('month'::text, l.created_at) = b.month)) AS total_requests,
    ( SELECT sum(l.total_tokens) AS sum
           FROM ai_usage_log l
          WHERE (date_trunc('month'::text, l.created_at) = b.month)) AS total_tokens,
    ( SELECT count(*) AS count
           FROM ai_usage_log l
          WHERE ((date_trunc('month'::text, l.created_at) = b.month) AND (NOT l.success))) AS failed_requests
   FROM ai_cost_budgets b
  ORDER BY month DESC;

-- 2. Fix curriculum_products_overview view  
DROP VIEW IF EXISTS public.curriculum_products_overview;
CREATE VIEW public.curriculum_products_overview
WITH (security_invoker=true) AS
SELECT 
    cp.id,
    cp.curriculum_id,
    cp.product_id,
    cp.course_id,
    cp.blueprint_id,
    cp.generation_status,
    cp.generation_error,
    cp.generated_at,
    cp.slug,
    cp.seo_title,
    cp.seo_description,
    cp.is_published,
    cp.published_at,
    cp.created_at,
    cp.updated_at,
    cp.created_by,
    c.title AS curriculum_title,
    c.status AS curriculum_status,
    sp.name AS product_name,
    sp.product_key,
    co.title AS course_title,
    eb.title AS blueprint_title,
    ( SELECT jsonb_object_agg(qc.check_type, qc.status) AS jsonb_object_agg
           FROM quality_checks qc
          WHERE (qc.curriculum_product_id = cp.id)) AS quality_status
   FROM curriculum_products cp
   JOIN curricula c ON (c.id = cp.curriculum_id)
   JOIN store_products sp ON (sp.id = cp.product_id)
   LEFT JOIN courses co ON (co.id = cp.course_id)
   LEFT JOIN exam_blueprints eb ON (eb.id = cp.blueprint_id);

-- 3. Fix azav_dashboard_stats view
DROP VIEW IF EXISTS public.azav_dashboard_stats;
CREATE VIEW public.azav_dashboard_stats
WITH (security_invoker=true) AS
SELECT 
    ( SELECT count(*) AS count
           FROM qm_documents) AS total_documents,
    ( SELECT count(*) AS count
           FROM azav_massnahmen_zulassungen) AS total_massnahmen,
    ( SELECT count(*) AS count
           FROM azav_massnahmen_zulassungen
          WHERE (zulassung_status = 'approved'::text)) AS approved_massnahmen,
    ( SELECT count(*) AS count
           FROM azav_massnahmen_zulassungen
          WHERE ((zulassung_bis IS NOT NULL) AND (zulassung_bis < (now() + '30 days'::interval)))) AS expiring_soon,
    ( SELECT count(*) AS count
           FROM azav_audit_log
          WHERE (audit_date >= (CURRENT_DATE - '30 days'::interval))) AS recent_audits,
    ( SELECT round((avg(
                CASE
                    WHEN (result = 'passed'::text) THEN 100
                    WHEN (result = 'partial'::text) THEN 50
                    ELSE 0
                END))::numeric, 1) AS round
           FROM azav_compliance_results
          WHERE (check_date >= (CURRENT_DATE - '90 days'::interval))) AS compliance_rate;

-- =====================================================
-- 4. Fix ai_tutor_logs INSERT policy - make it user-scoped
-- =====================================================
DROP POLICY IF EXISTS "Service role can insert tutor logs" ON public.ai_tutor_logs;

-- Create proper user-scoped insert policy
CREATE POLICY "Users can insert their own tutor logs"
ON public.ai_tutor_logs
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- =====================================================
-- 5. Add explicit deny for unauthenticated access to profiles
-- =====================================================
-- The existing policies already properly restrict access:
-- - "Users can view own profile or admins all" - SELECT with proper auth check
-- - "Users can insert their own profile" - INSERT with auth check
-- - "Users can update their own profile" - UPDATE with auth check
-- RLS is enabled, so unauthenticated users have no access by default.
-- Adding comment to document this security posture.
COMMENT ON TABLE public.profiles IS 'User profile data with PII (email, name, avatar). RLS enabled - only authenticated users can access their own data, admins can access all.';