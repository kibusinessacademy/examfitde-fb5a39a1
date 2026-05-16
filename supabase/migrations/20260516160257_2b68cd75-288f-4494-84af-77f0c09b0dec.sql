-- Track M7 Closure — Producer + Renewal Resolve RPC

-- 1) Update paywall_abandoned producer to stamp variant_key
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
      AND NOT EXISTS (
        SELECT 1 FROM public.entitlements e
        WHERE e.user_id = ce.user_id
          AND (e.valid_until IS NULL OR e.valid_until > v_now)
      )
  )
  INSERT INTO public.notification_jobs
    (user_id, kind, channel, dedupe_key, payload, scheduled_for, state)
  SELECT
    a.user_id, 'paywall_abandoned', 'email',
    'paywall_abandoned_24h:' || date_trunc('day', v_now)::date::text,
    jsonb_strip_nulls(jsonb_build_object(
      'intent_key','paywall_abandoned_24h',
      'package_id', a.package_id,
      'variant_key', public.fn_resolve_user_paywall_variant(a.user_id, NULL)
    )),
    v_now, 'pending'
  FROM abandoned a
  WHERE NOT p_dry_run
  ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_paywall_emitted = ROW_COUNT;

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
      'checkout_24h', v_checkout_24h_emitted,
      'variant_stamping', 'enabled'));

  RETURN jsonb_build_object(
    'paywall_abandoned_24h', v_paywall_emitted,
    'checkout_abandoned_1h', v_checkout_1h_emitted,
    'checkout_abandoned_24h', v_checkout_24h_emitted,
    'dry_run', p_dry_run);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_emit_monetization_intents(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_monetization_intents(boolean) TO service_role;

-- 2) Self-service renewal: resolve + consume token
CREATE OR REPLACE FUNCTION public.org_resolve_renewal_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.org_renewal_links;
  v_license public.org_licenses;
  v_org_name text;
  v_product_name text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT * INTO v_link FROM public.org_renewal_links WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_link.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  IF v_link.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_used', 'used_at', v_link.used_at);
  END IF;

  SELECT * INTO v_license FROM public.org_licenses WHERE id = v_link.license_id;
  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT name INTO v_product_name FROM public.products WHERE id = v_license.product_id;

  RETURN jsonb_build_object(
    'ok', true,
    'license_id', v_license.id,
    'org_id', v_link.org_id,
    'org_name', v_org_name,
    'product_id', v_license.product_id,
    'product_name', v_product_name,
    'seat_count', v_license.seat_count,
    'category', v_license.category,
    'expires_at', v_link.expires_at,
    'license_valid_until', v_license.valid_until
  );
END;
$$;
REVOKE ALL ON FUNCTION public.org_resolve_renewal_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_resolve_renewal_token(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_consume_renewal_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.org_renewal_links;
BEGIN
  SELECT * INTO v_link FROM public.org_renewal_links WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_link.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_used', true);
  END IF;
  UPDATE public.org_renewal_links SET used_at = now() WHERE id = v_link.id;
  RETURN jsonb_build_object('ok', true, 'license_id', v_link.license_id, 'org_id', v_link.org_id);
END;
$$;
REVOKE ALL ON FUNCTION public.org_consume_renewal_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_consume_renewal_token(text) TO authenticated, service_role;