-- Cut A: Paid-no-Grant + SLA-Breach Audit-Hygiene
-- 14-day forensic: 14,112 false-positive log rows aus Cron-Ticks ohne Findings.
-- Ground Truth: 0 echte Breaches, 0 echte Paid-no-Grant in 14 Tagen.
-- Fix: noop-Ticks NICHT mehr loggen. Echte Findings/Failures bleiben sichtbar.
-- RPC-Return-Payload unverändert (Cron-Health bleibt diagnostizierbar).

-- 1) SLA-Detector: nur loggen bei breached>0 ODER bei Wechsel skipped_smoke-Wert (Drift-Audit)
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
  v_last_skipped int;
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

  -- Audit-Hygiene: nur loggen, wenn echtes Finding ODER skipped_smoke-Drift
  SELECT COALESCE((metadata->>'skipped_smoke')::int, -1) INTO v_last_skipped
  FROM public.auto_heal_log
  WHERE action_type = 'post_purchase_delivery_sla_breach'
  ORDER BY created_at DESC LIMIT 1;

  IF v_breached > 0 OR v_skipped_smoke <> COALESCE(v_last_skipped, -1) THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
    VALUES (
      'post_purchase_delivery_sla_breach','system',
      CASE WHEN v_breached=0 THEN 'success' ELSE 'warn' END,
      'breached=' || v_breached || ' repaired=' || v_repaired || ' skipped_smoke=' || v_skipped_smoke,
      jsonb_build_object('breached', v_breached, 'repaired', v_repaired, 'skipped_smoke', v_skipped_smoke, 'minutes', p_minutes)
    );
  END IF;

  RETURN jsonb_build_object('breached', v_breached, 'repaired', v_repaired, 'skipped_smoke', v_skipped_smoke);
END $function$;

-- 2) Paid-no-Grant Auto-Repair: noop NICHT loggen, nur tatsächliche Repair-Aktionen oder Failures
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
    -- Audit-Hygiene: kein Log-Eintrag pro Cron-Tick ohne Kandidaten.
    -- Cron-Health bleibt über RPC-Return diagnostizierbar.
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
REVOKE ALL ON FUNCTION public.fn_detect_post_purchase_delivery_sla_breach(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_post_purchase_delivery_sla_breach(int) TO service_role;