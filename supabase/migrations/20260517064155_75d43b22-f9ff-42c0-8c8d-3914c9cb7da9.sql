-- =============================================================
-- Smoke-Order-Filter SSOT (Path A: Hygiene/Observability)
-- =============================================================

-- 1) Helper: canonical "smoke or synthetic" classifier
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
        -- Stripe synthetic / access test sessions
        COALESCE(o.stripe_checkout_session_id,'') LIKE 'cs_test_synthetic%'
        OR COALESCE(o.stripe_checkout_session_id,'') LIKE 'cs_test_access%'
        -- Test-/Smoke email domains (both auth + billing)
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
        -- Synthetic 0-EUR with no billing email
        OR (o.billing_email IS NULL AND COALESCE(o.total_cents,0) = 0)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_smoke_or_synthetic_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_smoke_or_synthetic_order(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_is_smoke_or_synthetic_order(uuid) IS
  'SSOT Smoke/Synthetic-Order Classifier. Genutzt von SLA-Detector + Admin-Cockpit RPCs, damit Test-Daten KPI/Ampel nicht dauerhaft rot halten.';

-- 2) SLA-Detector: Smoke-Orders überspringen
CREATE OR REPLACE FUNCTION public.fn_detect_post_purchase_delivery_sla_breach(p_minutes integer DEFAULT 2)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_breached int := 0;
  v_repaired int := 0;
  v_skipped_smoke int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.id, public.fn_is_smoke_or_synthetic_order(o.id) AS is_smoke
    FROM public.orders o
    WHERE o.status = 'paid'
      AND o.delivery_status <> 'confirmed'
      AND o.created_at < now() - (p_minutes::text || ' minutes')::interval
    ORDER BY o.created_at ASC
    LIMIT 100
  LOOP
    IF r.is_smoke THEN
      v_skipped_smoke := v_skipped_smoke + 1;
      CONTINUE;
    END IF;

    v_breached := v_breached + 1;
    BEGIN
      INSERT INTO public.job_queue(job_type, status, payload, priority, idempotency_key, meta, lane)
      VALUES (
        'post_purchase_delivery_audit_snapshot', 'pending',
        jsonb_build_object('order_id', r.id, 'enqueue_source', 'sla_breach_detector'),
        90,
        'post_purchase_sla|' || r.id::text || '|' || to_char(now(),'YYYYMMDDHH24MI'),
        jsonb_build_object('_origin','sla_breach','order_id', r.id),
        'commerce'
      );
      v_repaired := v_repaired + 1;
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'post_purchase_delivery_sla_breach','system',
    CASE WHEN v_breached=0 THEN 'success' ELSE 'warn' END,
    'breached=' || v_breached || ' repaired=' || v_repaired || ' skipped_smoke=' || v_skipped_smoke,
    jsonb_build_object('breached', v_breached, 'repaired', v_repaired, 'skipped_smoke', v_skipped_smoke, 'minutes', p_minutes)
  );

  RETURN jsonb_build_object('breached', v_breached, 'repaired', v_repaired, 'skipped_smoke', v_skipped_smoke);
END $function$;

-- 3) Cockpit-RPC: Smoke standardmäßig ausblenden, optional einblendbar
CREATE OR REPLACE FUNCTION public.admin_get_paid_but_not_delivered(
  p_limit integer DEFAULT 100,
  p_include_smoke boolean DEFAULT false
)
RETURNS TABLE(
  order_id uuid,
  buyer_user_id uuid,
  learner_user_id uuid,
  billing_email text,
  total_cents integer,
  paid_at timestamp with time zone,
  delivery_status text,
  delivery_blocking_reasons text[],
  delivery_last_checked_at timestamp with time zone,
  age_minutes integer,
  is_smoke boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    o.id,
    o.buyer_user_id,
    o.learner_user_id,
    o.billing_email,
    o.total_cents,
    o.created_at,
    o.delivery_status,
    o.delivery_blocking_reasons,
    o.delivery_last_checked_at,
    (EXTRACT(EPOCH FROM (now() - o.created_at))::int / 60) AS age_minutes,
    public.fn_is_smoke_or_synthetic_order(o.id) AS is_smoke
  FROM public.orders o
  WHERE public.has_role(auth.uid(), 'admin')
    AND o.status = 'paid'
    AND o.delivery_status <> 'confirmed'
    AND (p_include_smoke OR NOT public.fn_is_smoke_or_synthetic_order(o.id))
  ORDER BY o.created_at ASC
  LIMIT GREATEST(p_limit, 1);
$function$;

-- =============================================================
-- Smoke-Tests (manuell prüfen nach Apply):
-- =============================================================
-- A) Helper sollte alle 36 stuck Orders als smoke=true klassifizieren:
--    SELECT COUNT(*) FILTER (WHERE public.fn_is_smoke_or_synthetic_order(id)) AS smoke,
--           COUNT(*) AS total
--    FROM public.orders WHERE status='paid' AND delivery_status<>'confirmed';
--    Expect: smoke=36, total=36
--
-- B) SLA-Detector sollte nun 0 re-enqueued + 36 skipped_smoke melden:
--    SELECT public.fn_detect_post_purchase_delivery_sla_breach(2);
--
-- C) Cockpit-RPC default sollte 0 Zeilen liefern, mit p_include_smoke=>true 36:
--    SELECT COUNT(*) FROM public.admin_get_paid_but_not_delivered(100, false); -- 0
--    SELECT COUNT(*) FROM public.admin_get_paid_but_not_delivered(100, true);  -- 36
--
-- =============================================================
-- Rollback-Hint:
--   DROP FUNCTION public.fn_is_smoke_or_synthetic_order(uuid);
--   Vorherige Versionen von fn_detect_post_purchase_delivery_sla_breach +
--   admin_get_paid_but_not_delivered aus Git wiederherstellen.
-- =============================================================
