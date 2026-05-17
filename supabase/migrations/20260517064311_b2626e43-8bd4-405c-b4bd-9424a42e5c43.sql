CREATE OR REPLACE FUNCTION public.fn_is_smoke_or_synthetic_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    LEFT JOIN auth.users u
      ON u.id = COALESCE(o.learner_user_id, o.buyer_user_id)
    WHERE o.id = p_order_id
      AND (
        COALESCE(o.stripe_checkout_session_id,'') LIKE 'cs_test_synthetic%'
        OR COALESCE(o.stripe_checkout_session_id,'') LIKE 'cs_test_access%'
        OR COALESCE(o.stripe_checkout_session_id,'') LIKE 'cs_live_smoke_%'
        OR COALESCE(o.stripe_checkout_session_id,'') LIKE 'cs_test_smoke_%'
        OR COALESCE(u.email,'')           LIKE '%@examfit-smoke.local'
        OR COALESCE(u.email,'')           LIKE '%@test.examfit.de'
        OR COALESCE(u.email,'')           LIKE '%@test.local'
        OR COALESCE(u.email,'')           LIKE '%@example.test'
        OR COALESCE(o.billing_email,'')   LIKE '%@examfit-smoke.local'
        OR COALESCE(o.billing_email,'')   LIKE '%@test.examfit.de'
        OR COALESCE(o.billing_email,'')   LIKE '%@test.local'
        OR COALESCE(o.billing_email,'')   LIKE '%@example.test'
        OR COALESCE(o.billing_email,'')   LIKE 'smoke%'
        OR COALESCE(o.billing_email,'')   LIKE '%+smoke@%'
        OR (o.billing_email IS NULL AND COALESCE(o.total_cents,0) = 0)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_smoke_or_synthetic_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_smoke_or_synthetic_order(uuid) TO service_role;

-- Smoke-Test:
-- SELECT COUNT(*) FILTER (WHERE public.fn_is_smoke_or_synthetic_order(id)) AS smoke,
--        COUNT(*) AS total
-- FROM public.orders WHERE status='paid' AND delivery_status<>'confirmed';
-- Expect: smoke=36, total=36
