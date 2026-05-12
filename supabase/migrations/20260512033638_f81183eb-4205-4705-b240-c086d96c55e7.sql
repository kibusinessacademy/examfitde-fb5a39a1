
-- ===========================================================
-- 1) Health-Funktion härten — Filter aligned mit Repair-RPC
-- ===========================================================
CREATE OR REPLACE FUNCTION public.fn_launch_orders_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT o.*,
      COALESCE(o.learner_user_id, o.buyer_user_id) AS effective_uid,
      (SELECT email FROM auth.users WHERE id = COALESCE(o.learner_user_id, o.buyer_user_id)) AS effective_email
    FROM public.orders o
    WHERE o.created_at > now() - interval '24 hours'
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE
      -- Synthetic / E2E Stripe sessions ausschließen
      COALESCE(stripe_checkout_session_id, '') NOT LIKE 'cs_test_synthetic%'
      AND COALESCE(stripe_checkout_session_id, '') NOT LIKE 'cs_test_access%'
      -- Smoke + Test E-Mail-Domains ausschließen
      AND COALESCE(effective_email, '') NOT LIKE '%@examfit-smoke.local'
      AND COALESCE(effective_email, '') NOT LIKE '%@test.examfit.de'
  )
  SELECT jsonb_build_object(
    'pending_no_session', COUNT(*) FILTER (
      WHERE status='pending' AND stripe_checkout_session_id IS NULL
    ),
    'paid', COUNT(*) FILTER (WHERE status='paid'),
    'paid_no_grant', COUNT(*) FILTER (
      WHERE status='paid'
        AND effective_uid IS NOT NULL
        -- nur fulfillable Orders (gleiches Eligibility-Gate wie Repair)
        AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = filtered.id)
        AND EXISTS (
          SELECT 1 FROM public.order_items oi
          JOIN public.products p ON p.id = oi.product_id
          WHERE oi.order_id = filtered.id AND p.curriculum_id IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.order_items oi
          JOIN public.products p ON p.id = oi.product_id
          JOIN public.learner_course_grants g
            ON g.user_id = filtered.effective_uid AND g.curriculum_id = p.curriculum_id
          WHERE oi.order_id = filtered.id
        )
    )
  )
  FROM filtered;
$$;

-- ===========================================================
-- 2) Auto-Repair Wrapper für Cron (service_role)
-- ===========================================================
CREATE OR REPLACE FUNCTION public.fn_auto_repair_paid_no_grant()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_health jsonb;
  v_paid_no_grant int;
  v_result jsonb;
BEGIN
  v_health := public.fn_launch_orders_health();
  v_paid_no_grant := COALESCE((v_health->>'paid_no_grant')::int, 0);

  IF v_paid_no_grant = 0 THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('paid_no_grant_auto_repair', 'system', 'noop',
      jsonb_build_object('reason','no_candidates','health',v_health));
    RETURN jsonb_build_object('ran', false, 'reason', 'no_candidates', 'health', v_health);
  END IF;

  v_result := public.admin_repair_paid_orders_without_grant(NULL, false);

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    CASE
      WHEN COALESCE((v_result->>'failed')::int,0) > 0 THEN 'paid_no_grant_repair_failed'
      ELSE 'paid_no_grant_auto_repaired'
    END,
    'system',
    CASE
      WHEN COALESCE((v_result->>'failed')::int,0) > 0 THEN 'partial'
      ELSE 'success'
    END,
    jsonb_build_object('health_pre', v_health, 'repair_result', v_result)
  );

  RETURN jsonb_build_object('ran', true, 'health_pre', v_health, 'repair', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_repair_paid_no_grant() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_repair_paid_no_grant() TO service_role;
