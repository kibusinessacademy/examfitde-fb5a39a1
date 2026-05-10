
-- ROLLBACK HINT:
--   DROP VIEW IF EXISTS public.v_funnel_event_loss;
--   DROP FUNCTION IF EXISTS public.admin_get_funnel_event_loss();
--   DROP FUNCTION IF EXISTS public.fn_detect_funnel_event_loss();

-- =============================================================
-- 1) View — paid orders vs tracking events (24h window)
-- =============================================================
CREATE OR REPLACE VIEW public.v_funnel_event_loss AS
WITH window_24h AS (
  SELECT now() - interval '24 hours' AS since
),
paid AS (
  SELECT COUNT(*)::int AS n FROM public.orders, window_24h
  WHERE status = 'paid' AND updated_at >= window_24h.since
),
checkout_complete AS (
  SELECT COUNT(*)::int AS n FROM public.conversion_events, window_24h
  WHERE event_type IN ('checkout_complete','checkout_completed')
    AND created_at >= window_24h.since
),
pricing_view AS (
  SELECT COUNT(*)::int AS n FROM public.conversion_events, window_24h
  WHERE event_type = 'pricing_view' AND created_at >= window_24h.since
),
checkout_started AS (
  SELECT COUNT(*)::int AS n FROM public.conversion_events, window_24h
  WHERE event_type IN ('checkout_start','checkout_started') AND created_at >= window_24h.since
)
SELECT
  paid.n AS paid_orders_24h,
  checkout_complete.n AS checkout_complete_24h,
  checkout_started.n AS checkout_started_24h,
  pricing_view.n AS pricing_view_24h,
  CASE WHEN paid.n = 0 THEN NULL
       ELSE ROUND((checkout_complete.n::numeric / paid.n::numeric) * 100, 2)
  END AS checkout_complete_parity_pct,
  CASE
    WHEN paid.n = 0 THEN 'noop'
    WHEN checkout_complete.n::numeric / paid.n::numeric < 0.50 THEN 'CRIT'
    WHEN checkout_complete.n::numeric / paid.n::numeric < 0.95 THEN 'WARN'
    ELSE 'OK'
  END AS status,
  CASE
    WHEN paid.n > 0 AND pricing_view.n = 0 THEN true
    ELSE false
  END AS pricing_view_drought,
  now() AS computed_at
FROM paid, checkout_complete, pricing_view, checkout_started;

-- Lock down view: only service_role + admin RPC may read
REVOKE ALL ON public.v_funnel_event_loss FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_funnel_event_loss TO service_role;

-- =============================================================
-- 2) Admin RPC — has_role gate
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_get_funnel_event_loss()
RETURNS TABLE(
  paid_orders_24h int,
  checkout_complete_24h int,
  checkout_started_24h int,
  pricing_view_24h int,
  checkout_complete_parity_pct numeric,
  status text,
  pricing_view_drought boolean,
  computed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_funnel_event_loss;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_funnel_event_loss() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_funnel_event_loss() TO authenticated;

-- =============================================================
-- 3) Heal/Detector function (callable by cron, logs to auto_heal_log)
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_detect_funnel_event_loss()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_meta jsonb;
BEGIN
  SELECT * INTO v_row FROM public.v_funnel_event_loss;

  v_meta := jsonb_build_object(
    'paid_orders_24h',           v_row.paid_orders_24h,
    'checkout_complete_24h',     v_row.checkout_complete_24h,
    'checkout_started_24h',      v_row.checkout_started_24h,
    'pricing_view_24h',          v_row.pricing_view_24h,
    'parity_pct',                v_row.checkout_complete_parity_pct,
    'status',                    v_row.status,
    'pricing_view_drought',      v_row.pricing_view_drought
  );

  INSERT INTO public.auto_heal_log
    (action_type, trigger_source, target_type, result_status, metadata)
  VALUES
    ('funnel_event_loss_detection',
     'cron_funnel_loss_detect_hourly',
     'system',
     CASE v_row.status
       WHEN 'CRIT' THEN 'crit'
       WHEN 'WARN' THEN 'warn'
       WHEN 'OK'   THEN 'success'
       ELSE 'noop'
     END,
     v_meta);

  RETURN v_meta;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_funnel_event_loss() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_funnel_event_loss() TO service_role;

-- =============================================================
-- 4) Smoke
-- =============================================================
DO $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM public.v_funnel_event_loss;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'v_funnel_event_loss returned no row';
  END IF;
END$$;

INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, result_status, metadata)
VALUES ('funnel_event_loss_install', 'migration', 'system', 'success',
        jsonb_build_object('migration','funnel_loss_view_and_detector_v1'));
