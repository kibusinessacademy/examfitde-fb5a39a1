
-- =============================================
-- FIX 1: Entitlements table - add explicit DENY write policies
-- =============================================

-- Block direct INSERT by authenticated users
CREATE POLICY "deny_direct_entitlement_insert"
  ON public.entitlements FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- Block direct UPDATE by authenticated users
CREATE POLICY "deny_direct_entitlement_update"
  ON public.entitlements FOR UPDATE
  TO authenticated
  USING (false);

-- Block direct DELETE by authenticated users
CREATE POLICY "deny_direct_entitlement_delete"
  ON public.entitlements FOR DELETE
  TO authenticated
  USING (false);

-- =============================================
-- FIX 2: Convert all SECURITY DEFINER views to SECURITY INVOKER
-- =============================================

ALTER VIEW public.admin_elite_matrix_curriculum_v SET (security_invoker = on);
ALTER VIEW public.admin_elite_matrix_v SET (security_invoker = on);
ALTER VIEW public.affiliate_referrals_safe SET (security_invoker = on);
ALTER VIEW public.ai_cost_overview SET (security_invoker = on);
ALTER VIEW public.ai_worker_health SET (security_invoker = on);
ALTER VIEW public.azav_dashboard_stats SET (security_invoker = on);
ALTER VIEW public.blueprint_questions_view SET (security_invoker = on);
ALTER VIEW public.certification_cost_summary SET (security_invoker = on);
ALTER VIEW public.curriculum_elite_coverage_v SET (security_invoker = on);
ALTER VIEW public.curriculum_elite_summary_v SET (security_invoker = on);
ALTER VIEW public.curriculum_products_overview SET (security_invoker = on);
ALTER VIEW public.exam_questions_elite_v SET (security_invoker = on);
ALTER VIEW public.exam_questions_safe SET (security_invoker = on);
ALTER VIEW public.job_artifact_blocked_mode SET (security_invoker = on);
ALTER VIEW public.job_artifact_blockers_top SET (security_invoker = on);
ALTER VIEW public.job_artifact_blocks SET (security_invoker = on);
ALTER VIEW public.job_deadletter SET (security_invoker = on);
ALTER VIEW public.job_error_stats_24h SET (security_invoker = on);
ALTER VIEW public.job_failure_analysis SET (security_invoker = on);
ALTER VIEW public.job_health_kpis SET (security_invoker = on);
ALTER VIEW public.job_pool_health SET (security_invoker = on);
ALTER VIEW public.job_processing_age SET (security_invoker = on);
ALTER VIEW public.job_queue_pressure SET (security_invoker = on);
ALTER VIEW public.lesson_qc_view SET (security_invoker = on);
ALTER VIEW public.license_seats_safe SET (security_invoker = on);
ALTER VIEW public.ops_blocked_packages SET (security_invoker = on);
ALTER VIEW public.ops_blueprint_quality_kpis SET (security_invoker = on);
ALTER VIEW public.ops_content_factory SET (security_invoker = on);
ALTER VIEW public.ops_cost_summary SET (security_invoker = on);
ALTER VIEW public.ops_heal_effectiveness SET (security_invoker = on);
ALTER VIEW public.ops_hollow_completions SET (security_invoker = on);
ALTER VIEW public.ops_job_summary SET (security_invoker = on);
ALTER VIEW public.ops_runner_integrity SET (security_invoker = on);
ALTER VIEW public.ops_runner_integrity_details SET (security_invoker = on);
ALTER VIEW public.ops_seeding_summary SET (security_invoker = on);
ALTER VIEW public.pipeline_artifact_blocked SET (security_invoker = on);
ALTER VIEW public.pipeline_deadlock_detection SET (security_invoker = on);
ALTER VIEW public.pool_concurrency_recommendation SET (security_invoker = on);
ALTER VIEW public.stale_elite_annotations_v SET (security_invoker = on);
ALTER VIEW public.step_performance_stats SET (security_invoker = on);
ALTER VIEW public.v_drift_analytics SET (security_invoker = on);
ALTER VIEW public.v_exam_pool_lf_elite_agg SET (security_invoker = on);
ALTER VIEW public.v_exam_questions_approved SET (security_invoker = on);
ALTER VIEW public.v_growth_actions_approved SET (security_invoker = on);
ALTER VIEW public.v_qa_last_runs SET (security_invoker = on);
ALTER VIEW public.v_qa_open_findings SET (security_invoker = on);
ALTER VIEW public.v_qa_risk_acceptances SET (security_invoker = on);
ALTER VIEW public.v_revenue_daily SET (security_invoker = on);
ALTER VIEW public.v_roi_certification SET (security_invoker = on);
ALTER VIEW public.v_vat_monthly SET (security_invoker = on);
