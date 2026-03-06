
CREATE OR REPLACE VIEW public.v_revenue_health AS
SELECT 
  (SELECT count(*) FROM public.orders WHERE created_at::timestamptz >= CURRENT_DATE - interval '30 days') AS orders_30d,
  (SELECT coalesce(sum(total_cents), 0) / 100.0 FROM public.orders WHERE created_at::timestamptz >= CURRENT_DATE - interval '30 days') AS revenue_30d_eur,
  (SELECT coalesce(sum(total_cents), 0) / 100.0 FROM public.orders WHERE created_at::timestamptz >= CURRENT_DATE - interval '7 days') AS revenue_7d_eur,
  (SELECT coalesce(sum(total_cents), 0) / 100.0 FROM public.orders WHERE created_at::timestamptz >= CURRENT_DATE) AS revenue_today_eur,
  (SELECT count(*) FROM public.orders WHERE created_at::timestamptz >= CURRENT_DATE - interval '30 days' AND status = 'refunded') AS refunds_30d,
  (SELECT count(*) FROM public.affiliates WHERE status = 'active') AS active_affiliates,
  (SELECT coalesce(sum(pending_payout), 0) FROM public.affiliates) AS pending_affiliate_payouts,
  (SELECT count(*) FROM public.churn_predictions WHERE risk_score > 70) AS high_churn_users,
  (SELECT count(*) FROM public.course_packages WHERE status = 'done') AS packages_ready_unpublished,
  (SELECT count(*) FROM public.course_packages WHERE status = 'quality_gate_failed') AS packages_blocked;
