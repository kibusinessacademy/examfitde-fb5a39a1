-- COURSE.PROFIT.OS.1 — Latest-per-product view for cockpit aggregation.
CREATE OR REPLACE VIEW public.v_course_profitability_latest AS
SELECT DISTINCT ON (s.product_id)
  s.id, s.product_id, s.product_title, s.product_slug,
  s.window_days, s.units_sold,
  s.gross_revenue_cents, s.stripe_fees_cents, s.refunds_cents, s.net_revenue_cents,
  s.ai_cost_cents, s.build_cost_cents, s.overhead_cents, s.total_cost_cents,
  s.margin_cents, s.margin_ratio, s.payback_units,
  s.class, s.recommendation_code, s.recommendation_reason,
  s.confidence, s.inputs_hash, s.evaluator_version,
  s.cost_breakdown, s.revenue_breakdown, s.created_at
FROM public.course_profitability_snapshots s
ORDER BY s.product_id, s.created_at DESC;

GRANT SELECT ON public.v_course_profitability_latest TO authenticated;
GRANT ALL ON public.v_course_profitability_latest TO service_role;

COMMENT ON VIEW public.v_course_profitability_latest IS
  'COURSE.PROFIT.OS.1 — latest snapshot per product_id. Read-only projection. Admin RLS inherited via underlying table.';