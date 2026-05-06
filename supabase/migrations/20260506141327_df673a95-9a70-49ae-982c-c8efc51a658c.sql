
DROP VIEW IF EXISTS public.v_system_audit_executive;
CREATE VIEW public.v_system_audit_executive AS
WITH
zombie_total AS (
  SELECT COUNT(*)::int AS n FROM public.course_packages cp
  WHERE cp.blocked_reason='auto_heal_zombie'
),
zombie_eligible AS (
  SELECT COUNT(*)::int AS n FROM public.course_packages cp
  WHERE cp.blocked_reason='auto_heal_zombie'
    AND cp.status IN ('blocked','queued')
    AND cp.product_id IS NOT NULL
    AND (SELECT COUNT(*) FROM public.exam_questions eq
         WHERE eq.curriculum_id=cp.curriculum_id AND eq.status='approved') >= 50
    AND EXISTS (SELECT 1 FROM public.product_prices pp
                WHERE pp.product_id=cp.product_id AND pp.active AND pp.stripe_price_id IS NOT NULL)
),
grant_drift AS (
  SELECT COUNT(*)::int AS n FROM public.learner_course_grants g
  WHERE g.status='active'
    AND NOT EXISTS (SELECT 1 FROM public.entitlements e
                    WHERE e.user_id=g.user_id AND e.curriculum_id=g.curriculum_id)
),
paid_no_grant AS (
  SELECT COUNT(*)::int AS n FROM public.orders o
  WHERE o.status='paid'
    AND COALESCE(o.learner_user_id,o.buyer_user_id) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.products p ON p.id=oi.product_id
      JOIN public.learner_course_grants g
        ON g.user_id=COALESCE(o.learner_user_id,o.buyer_user_id) AND g.curriculum_id=p.curriculum_id
      WHERE oi.order_id=o.id)
    AND COALESCE(o.learner_user_id,o.buyer_user_id) NOT IN (
      SELECT id FROM auth.users WHERE email LIKE '%@examfit-smoke.local')
),
sellable_published AS (
  SELECT COUNT(*)::int AS n FROM public.course_packages cp
  WHERE cp.status='published' AND cp.product_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.product_prices pp
                WHERE pp.product_id=cp.product_id AND pp.active AND pp.stripe_price_id IS NOT NULL)
)
SELECT
  (SELECT n FROM zombie_total)        AS zombie_total,
  (SELECT n FROM zombie_eligible)     AS zombie_eligible_for_unblock,
  (SELECT n FROM grant_drift)         AS grant_entitlement_drift,
  (SELECT n FROM paid_no_grant)       AS paid_orders_without_grant,
  (SELECT n FROM sellable_published)  AS sellable_published_packages,
  now() AS computed_at;

REVOKE ALL ON public.v_system_audit_executive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_system_audit_executive TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_system_audit_executive()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_row FROM public.v_system_audit_executive;
  RETURN to_jsonb(v_row);
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_system_audit_executive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_system_audit_executive() TO authenticated, service_role;
