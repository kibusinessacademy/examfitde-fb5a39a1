
-- =========================================================
-- Track M1: Monetization Intent Pack
-- =========================================================

-- 1) Extend notification_jobs.kind check constraint
ALTER TABLE public.notification_jobs DROP CONSTRAINT IF EXISTS notification_jobs_kind_check;
ALTER TABLE public.notification_jobs ADD CONSTRAINT notification_jobs_kind_check
  CHECK (kind = ANY (ARRAY[
    'daily_reminder','rescue','streak_recovery','exam_countdown',
    'weak_competency','readiness_summary',
    -- M1 monetization kinds
    'paywall_abandoned','checkout_abandoned',
    'readiness_red_upsell','bundle_upsell','org_seat_expiring'
  ]));

-- 2) Seed monetization intents
INSERT INTO public.notification_intent_registry
  (intent_key, label, description, trigger_reason, default_cta_label, default_cta_path,
   recovery_action, max_per_day, respects_quiet_hours, respects_fatigue, enabled,
   safety_class, min_delivery_floor, governance_notes)
VALUES
  ('paywall_abandoned_24h',
   'Paywall verlassen (24h)',
   'Erinnert Lernende, die eine Paywall gesehen, aber nicht gekauft haben.',
   'paywall_view ohne checkout_complete >24h',
   'Jetzt freischalten', '/shop',
   'followup_email', 1, true, true, true,
   'standard', 'none',
   'Monetization: 1 Nachricht pro Tag, respect fatigue. Niemals an bezahlte Nutzer.'),
  ('checkout_abandoned_1h',
   'Checkout abgebrochen (1h)',
   'Stupst Nutzer kurz nach Checkout-Start ohne Abschluss erneut an.',
   'checkout_start ohne checkout_complete >1h <24h',
   'Kauf abschließen', '/checkout',
   'followup_email', 1, true, true, true,
   'standard', 'neutral',
   'Hohe Conversion-Stage – earliest stage of cart recovery.'),
  ('checkout_abandoned_24h',
   'Checkout abgebrochen (24h)',
   'Zweiter Recovery-Hinweis 24h nach Checkout-Start ohne Abschluss.',
   'checkout_start ohne checkout_complete >24h <72h',
   'Kauf abschließen', '/checkout',
   'followup_email', 1, true, true, true,
   'standard', 'none',
   'Sekundär – nur wenn 1h-Variante nicht gewirkt hat (Cron-Logik).'),
  ('readiness_red_upsell',
   'Prüfungsreife rot — Upsell',
   'Bietet Lernenden mit kritisch niedrigem Score gezielten Premium-Zugang an.',
   'readiness_score < 40 und kein active entitlement',
   'Premium freischalten', '/shop',
   'inapp_reminder', 1, true, true, true,
   'sensitive', 'none',
   'Sensitiv: nie alarmistisch, niemals an aktive Bezahler. Floor=none → Engine kann downranken.'),
  ('bundle_upsell_after_first_pass',
   'Bundle-Upsell nach erstem Bestehen',
   'Schlägt nach erfolgreichem Abschluss verwandte Kurse als Bundle vor.',
   'exam_attempt completed_pass + curriculum_upsell_paths vorhanden',
   'Bundle ansehen', '/shop',
   'none', 1, true, true, true,
   'standard', 'none',
   'Post-success Cross-Sell. Niemals während laufendem Prüfungsdruck.'),
  ('org_seat_expiring_30d',
   'B2B-Seat läuft in 30 Tagen aus',
   'Erinnert Org-Admins an bald ablaufende Lizenzen für Renewal.',
   'org_license.valid_until < now()+30d, status=active',
   'Lizenz verlängern', '/admin/licenses',
   'followup_email', 1, true, true, true,
   'standard', 'neutral',
   'B2B-Renewal-Hebel. Maximal 1x in 30 Tagen.')
ON CONFLICT (intent_key) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      trigger_reason = EXCLUDED.trigger_reason,
      default_cta_label = EXCLUDED.default_cta_label,
      default_cta_path = EXCLUDED.default_cta_path,
      recovery_action = EXCLUDED.recovery_action,
      safety_class = EXCLUDED.safety_class,
      min_delivery_floor = EXCLUDED.min_delivery_floor,
      governance_notes = EXCLUDED.governance_notes,
      updated_at = now();

-- 3) Producer function: scan conversion_events and emit monetization jobs
CREATE OR REPLACE FUNCTION public.fn_emit_monetization_intents(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paywall_emitted int := 0;
  v_checkout_1h_emitted int := 0;
  v_checkout_24h_emitted int := 0;
  v_now timestamptz := now();
BEGIN
  -- paywall_abandoned_24h: users who saw paywall_view 24-72h ago without subsequent checkout_complete
  WITH abandoned AS (
    SELECT DISTINCT ce.user_id, ce.package_id
    FROM public.conversion_events ce
    WHERE ce.event_type IN ('paywall_view','pricing_view')
      AND ce.user_id IS NOT NULL
      AND ce.created_at BETWEEN v_now - interval '72 hours' AND v_now - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.conversion_events ce2
        WHERE ce2.user_id = ce.user_id
          AND ce2.event_type IN ('checkout_complete','checkout_completed')
          AND ce2.created_at >= ce.created_at
      )
      -- skip users with any active entitlement
      AND NOT EXISTS (
        SELECT 1 FROM public.entitlements e
        WHERE e.user_id = ce.user_id
          AND (e.valid_until IS NULL OR e.valid_until > v_now)
      )
  )
  INSERT INTO public.notification_jobs
    (user_id, kind, channel, dedupe_key, payload, scheduled_for, state)
  SELECT
    a.user_id,
    'paywall_abandoned',
    'email',
    'paywall_abandoned_24h:' || date_trunc('day', v_now)::date::text,
    jsonb_build_object('intent_key','paywall_abandoned_24h','package_id', a.package_id),
    v_now,
    'pending'
  FROM abandoned a
  WHERE NOT p_dry_run
  ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_paywall_emitted = ROW_COUNT;

  -- checkout_abandoned_1h
  WITH abandoned AS (
    SELECT DISTINCT ce.user_id, ce.package_id
    FROM public.conversion_events ce
    WHERE ce.event_type IN ('checkout_start','checkout_started')
      AND ce.user_id IS NOT NULL
      AND ce.created_at BETWEEN v_now - interval '24 hours' AND v_now - interval '1 hour'
      AND NOT EXISTS (
        SELECT 1 FROM public.conversion_events ce2
        WHERE ce2.user_id = ce.user_id
          AND ce2.event_type IN ('checkout_complete','checkout_completed')
          AND ce2.created_at >= ce.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.entitlements e
        WHERE e.user_id = ce.user_id
          AND (e.valid_until IS NULL OR e.valid_until > v_now)
      )
  )
  INSERT INTO public.notification_jobs
    (user_id, kind, channel, dedupe_key, payload, scheduled_for, state)
  SELECT
    a.user_id, 'checkout_abandoned', 'email',
    'checkout_abandoned_1h:' || date_trunc('day', v_now)::date::text,
    jsonb_build_object('intent_key','checkout_abandoned_1h','package_id', a.package_id),
    v_now, 'pending'
  FROM abandoned a
  WHERE NOT p_dry_run
  ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_checkout_1h_emitted = ROW_COUNT;

  -- checkout_abandoned_24h
  WITH abandoned AS (
    SELECT DISTINCT ce.user_id, ce.package_id
    FROM public.conversion_events ce
    WHERE ce.event_type IN ('checkout_start','checkout_started')
      AND ce.user_id IS NOT NULL
      AND ce.created_at BETWEEN v_now - interval '72 hours' AND v_now - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.conversion_events ce2
        WHERE ce2.user_id = ce.user_id
          AND ce2.event_type IN ('checkout_complete','checkout_completed')
          AND ce2.created_at >= ce.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.entitlements e
        WHERE e.user_id = ce.user_id
          AND (e.valid_until IS NULL OR e.valid_until > v_now)
      )
  )
  INSERT INTO public.notification_jobs
    (user_id, kind, channel, dedupe_key, payload, scheduled_for, state)
  SELECT
    a.user_id, 'checkout_abandoned', 'email',
    'checkout_abandoned_24h:' || date_trunc('day', v_now)::date::text,
    jsonb_build_object('intent_key','checkout_abandoned_24h','package_id', a.package_id),
    v_now, 'pending'
  FROM abandoned a
  WHERE NOT p_dry_run
  ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_checkout_24h_emitted = ROW_COUNT;

  INSERT INTO public.auto_heal_log (action_type, result_status, details)
  VALUES ('monetization_intent_producer_run', 'success',
    jsonb_build_object(
      'dry_run', p_dry_run,
      'paywall_24h', v_paywall_emitted,
      'checkout_1h', v_checkout_1h_emitted,
      'checkout_24h', v_checkout_24h_emitted));

  RETURN jsonb_build_object(
    'paywall_abandoned_24h', v_paywall_emitted,
    'checkout_abandoned_1h', v_checkout_1h_emitted,
    'checkout_abandoned_24h', v_checkout_24h_emitted,
    'dry_run', p_dry_run);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_emit_monetization_intents(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_monetization_intents(boolean) TO service_role;

-- 4) Revenue attribution view
CREATE OR REPLACE VIEW public.v_notification_revenue_attribution AS
WITH dispatches AS (
  SELECT d.id AS decision_id, d.job_id, d.intent_key, d.persona,
         d.effective_action, d.decided_at, j.user_id
    FROM public.notification_dispatch_decisions d
    JOIN public.notification_jobs j ON j.id = d.job_id
),
linked_orders AS (
  SELECT d.intent_key, d.persona, d.effective_action, d.decided_at,
         o.id AS order_id, o.total_cents, o.status, o.created_at AS order_created_at
    FROM dispatches d
    LEFT JOIN public.orders o
      ON o.buyer_user_id = d.user_id
     AND o.status = 'paid'
     AND o.created_at BETWEEN d.decided_at AND d.decided_at + interval '7 days'
)
SELECT
  intent_key,
  persona,
  COUNT(*) FILTER (WHERE effective_action = 'allowed') AS dispatches_allowed,
  COUNT(*) FILTER (WHERE effective_action = 'suppressed') AS dispatches_suppressed,
  COUNT(DISTINCT order_id) FILTER (WHERE order_id IS NOT NULL) AS orders_attributed,
  COALESCE(SUM(total_cents) FILTER (WHERE order_id IS NOT NULL AND effective_action = 'allowed'), 0) AS revenue_cents_attributed,
  CASE WHEN COUNT(*) FILTER (WHERE effective_action = 'allowed') > 0
       THEN ROUND(100.0 * COUNT(DISTINCT order_id) FILTER (WHERE order_id IS NOT NULL AND effective_action='allowed')
                  / NULLIF(COUNT(*) FILTER (WHERE effective_action='allowed'),0), 2)
       ELSE 0 END AS conversion_pct
FROM linked_orders
GROUP BY intent_key, persona;

REVOKE ALL ON public.v_notification_revenue_attribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_notification_revenue_attribution TO service_role;

-- 5) Admin RPC
CREATE OR REPLACE FUNCTION public.admin_get_notification_revenue_attribution(p_window text DEFAULT '30d')
RETURNS TABLE(
  intent_key text, persona text,
  dispatches_allowed bigint, dispatches_suppressed bigint,
  orders_attributed bigint, revenue_cents_attributed bigint,
  conversion_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_interval interval := CASE p_window
    WHEN '24h' THEN interval '24 hours'
    WHEN '7d' THEN interval '7 days'
    WHEN '30d' THEN interval '30 days'
    ELSE interval '30 days' END;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  WITH dispatches AS (
    SELECT d.id AS decision_id, d.job_id, d.intent_key, d.persona,
           d.effective_action, d.decided_at, j.user_id
      FROM public.notification_dispatch_decisions d
      JOIN public.notification_jobs j ON j.id = d.job_id
     WHERE d.decided_at >= now() - v_interval
  ),
  linked_orders AS (
    SELECT d.intent_key, d.persona, d.effective_action, d.decided_at,
           o.id AS order_id, o.total_cents
      FROM dispatches d
      LEFT JOIN public.orders o
        ON o.buyer_user_id = d.user_id
       AND o.status = 'paid'
       AND o.created_at BETWEEN d.decided_at AND d.decided_at + interval '7 days'
  )
  SELECT
    lo.intent_key, lo.persona,
    COUNT(*) FILTER (WHERE lo.effective_action = 'allowed')::bigint,
    COUNT(*) FILTER (WHERE lo.effective_action = 'suppressed')::bigint,
    COUNT(DISTINCT lo.order_id) FILTER (WHERE lo.order_id IS NOT NULL)::bigint,
    COALESCE(SUM(lo.total_cents) FILTER (WHERE lo.order_id IS NOT NULL AND lo.effective_action='allowed'), 0)::bigint,
    CASE WHEN COUNT(*) FILTER (WHERE lo.effective_action='allowed') > 0
         THEN ROUND(100.0 * COUNT(DISTINCT lo.order_id) FILTER (WHERE lo.order_id IS NOT NULL AND lo.effective_action='allowed')
                    / NULLIF(COUNT(*) FILTER (WHERE lo.effective_action='allowed'),0), 2)
         ELSE 0 END
  FROM linked_orders lo
  GROUP BY lo.intent_key, lo.persona
  ORDER BY revenue_cents_attributed DESC NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_notification_revenue_attribution(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_revenue_attribution(text) TO authenticated, service_role;

-- 6) Smoke test
CREATE OR REPLACE FUNCTION public.admin_smoke_monetization_intents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected text[] := ARRAY[
    'paywall_abandoned_24h','checkout_abandoned_1h','checkout_abandoned_24h',
    'readiness_red_upsell','bundle_upsell_after_first_pass','org_seat_expiring_30d'];
  v_found int;
  v_dry jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT count(*) INTO v_found
  FROM public.notification_intent_registry
  WHERE intent_key = ANY(v_expected) AND enabled = true;

  v_dry := public.fn_emit_monetization_intents(true);

  RETURN jsonb_build_object(
    'intents_registered', v_found,
    'intents_expected', array_length(v_expected,1),
    'producer_dry_run', v_dry,
    'status', CASE WHEN v_found = array_length(v_expected,1) THEN 'green' ELSE 'red' END);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_smoke_monetization_intents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_smoke_monetization_intents() TO authenticated, service_role;
