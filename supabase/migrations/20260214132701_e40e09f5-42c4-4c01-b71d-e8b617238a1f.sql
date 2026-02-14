-- Fix: Set all public views to SECURITY INVOKER so they respect the querying user's RLS policies
-- instead of the view creator's permissions. This addresses the Supabase linter error SUPA_security_definer_view.

ALTER VIEW public.affiliate_referrals_safe SET (security_invoker = true);
ALTER VIEW public.ai_cost_overview SET (security_invoker = true);
ALTER VIEW public.ai_worker_health SET (security_invoker = true);
ALTER VIEW public.azav_dashboard_stats SET (security_invoker = true);
ALTER VIEW public.blueprint_questions_view SET (security_invoker = true);
ALTER VIEW public.certification_cost_summary SET (security_invoker = true);
ALTER VIEW public.curriculum_products_overview SET (security_invoker = true);
ALTER VIEW public.exam_questions_safe SET (security_invoker = true);
ALTER VIEW public.job_deadletter SET (security_invoker = true);
ALTER VIEW public.job_failure_analysis SET (security_invoker = true);
ALTER VIEW public.job_health_kpis SET (security_invoker = true);
ALTER VIEW public.lesson_qc_view SET (security_invoker = true);
ALTER VIEW public.license_seats_safe SET (security_invoker = true);
ALTER VIEW public.ops_blocked_packages SET (security_invoker = true);
ALTER VIEW public.ops_content_factory SET (security_invoker = true);
ALTER VIEW public.ops_cost_summary SET (security_invoker = true);
ALTER VIEW public.ops_heal_effectiveness SET (security_invoker = true);
ALTER VIEW public.ops_health_summary SET (security_invoker = true);
ALTER VIEW public.ops_job_summary SET (security_invoker = true);
ALTER VIEW public.ops_seeding_summary SET (security_invoker = true);
ALTER VIEW public.pipeline_health SET (security_invoker = true);
ALTER VIEW public.v_exam_questions_approved SET (security_invoker = true);
ALTER VIEW public.v_growth_actions_approved SET (security_invoker = true);
ALTER VIEW public.v_qa_last_runs SET (security_invoker = true);
ALTER VIEW public.v_qa_open_findings SET (security_invoker = true);
ALTER VIEW public.v_qa_risk_acceptances SET (security_invoker = true);
ALTER VIEW public.v_revenue_daily SET (security_invoker = true);
ALTER VIEW public.v_roi_certification SET (security_invoker = true);
ALTER VIEW public.v_vat_monthly SET (security_invoker = true);