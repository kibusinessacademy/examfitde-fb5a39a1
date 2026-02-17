
-- ═══════════════════════════════════════════════════════════
-- HIGH-PRIO SECURITY FIX 1: 19 Views → security_invoker = on
-- ═══════════════════════════════════════════════════════════

ALTER VIEW public.corporate_seat_utilization SET (security_invoker = on);
ALTER VIEW public.cost_intelligence SET (security_invoker = on);
ALTER VIEW public.cost_quality_heatmap SET (security_invoker = on);
ALTER VIEW public.course_package_build_steps SET (security_invoker = on);
ALTER VIEW public.error_observatory SET (security_invoker = on);
ALTER VIEW public.package_economics SET (security_invoker = on);
ALTER VIEW public.quality_drift_monitor SET (security_invoker = on);
ALTER VIEW public.v_b2b_metrics SET (security_invoker = on);
ALTER VIEW public.v_cost_per_question SET (security_invoker = on);
ALTER VIEW public.v_escalation_rate SET (security_invoker = on);
ALTER VIEW public.v_failed_job_clusters SET (security_invoker = on);
ALTER VIEW public.v_level_pricing SET (security_invoker = on);
ALTER VIEW public.v_ltv_user SET (security_invoker = on);
ALTER VIEW public.v_pipeline_alerts SET (security_invoker = on);
ALTER VIEW public.v_pipeline_execution_health SET (security_invoker = on);
ALTER VIEW public.v_price_recommendation SET (security_invoker = on);
ALTER VIEW public.v_profit_forecast SET (security_invoker = on);
ALTER VIEW public.v_revenue_cost_ratio SET (security_invoker = on);
ALTER VIEW public.v_unit_economics_package SET (security_invoker = on);

-- ═══════════════════════════════════════════════════════════
-- HIGH-PRIO SECURITY FIX 2: RLS auf pipeline_step_order
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_step_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pipeline_step_order"
ON public.pipeline_step_order
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages pipeline_step_order"
ON public.pipeline_step_order
FOR ALL
USING (true)
WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- MEDIUM: search_path auf bekannte Trigger-Functions
-- ═══════════════════════════════════════════════════════════

ALTER FUNCTION public.guard_lesson_content_writes() SET search_path = public;
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.prevent_seat_reassignment() SET search_path = public;
