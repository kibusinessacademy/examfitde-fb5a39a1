
-- Fix: Add security_invoker=on to v_roi_certification view
-- This ensures RLS policies of the querying user are enforced, not the view creator

DROP VIEW IF EXISTS public.v_roi_certification;

CREATE VIEW public.v_roi_certification
WITH (security_invoker = on) AS
SELECT 
    COALESCE(lc.certification_id, re.certification_id) AS certification_id,
    COALESCE(sum(re.amount) FILTER (WHERE re.event_type = ANY (ARRAY['purchase'::text, 'renewal'::text])), 0::numeric) AS revenue_eur,
    COALESCE(sum(re.amount) FILTER (WHERE re.event_type = 'refund'::text), 0::numeric) AS refunds_eur,
    COALESCE(sum(lc.cost_eur), 0::numeric) AS llm_cost_eur,
    COALESCE(sum(lc.tokens_in) + sum(lc.tokens_out), 0::bigint) AS total_tokens,
    COALESCE(sum(re.amount) FILTER (WHERE re.event_type = ANY (ARRAY['purchase'::text, 'renewal'::text])), 0::numeric) - COALESCE(sum(re.amount) FILTER (WHERE re.event_type = 'refund'::text), 0::numeric) - COALESCE(sum(lc.cost_eur), 0::numeric) AS net_profit_eur,
    count(DISTINCT re.id) FILTER (WHERE re.event_type = 'purchase'::text) AS total_orders
FROM llm_cost_events lc
FULL JOIN revenue_events re ON lc.certification_id = re.certification_id
WHERE COALESCE(lc.certification_id, re.certification_id) IS NOT NULL
GROUP BY COALESCE(lc.certification_id, re.certification_id);
