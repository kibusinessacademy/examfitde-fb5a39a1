
-- ============================================================
-- Track M7 — Monetization Closure v4
-- ============================================================

-- 1) STRIPE-PAID REVERSE: suppress pending checkout_abandoned jobs
CREATE OR REPLACE FUNCTION public.fn_m7_reverse_checkout_abandoned_on_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suppressed int := 0;
BEGIN
  IF NEW.event_type NOT IN ('payment_succeeded','checkout_completed','order_paid') THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.notification_jobs
  SET state = 'suppressed',
      suppression_reason = 'm7_paid_after_abandon',
      updated_at = now()
  WHERE user_id = NEW.user_id
    AND kind = 'checkout_abandoned'
    AND state = 'pending';
  GET DIAGNOSTICS v_suppressed = ROW_COUNT;

  IF v_suppressed > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, payload)
    VALUES (
      'm7_checkout_abandoned_reversed',
      'user',
      NEW.user_id::text,
      'success',
      jsonb_build_object(
        'suppressed_count', v_suppressed,
        'trigger_event', NEW.event_type,
        'conversion_event_id', NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_m7_reverse_checkout_abandoned ON public.conversion_events;
CREATE TRIGGER trg_m7_reverse_checkout_abandoned
AFTER INSERT ON public.conversion_events
FOR EACH ROW
EXECUTE FUNCTION public.fn_m7_reverse_checkout_abandoned_on_paid();

-- ============================================================
-- 2) SELF-SERVICE RENEWAL LINKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_renewal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES public.org_licenses(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_renewal_links_org ON public.org_renewal_links(org_id);
CREATE INDEX IF NOT EXISTS idx_org_renewal_links_license ON public.org_renewal_links(license_id);

ALTER TABLE public.org_renewal_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "renewal_links_admin_read" ON public.org_renewal_links;
CREATE POLICY "renewal_links_admin_read"
ON public.org_renewal_links FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "renewal_links_service_all" ON public.org_renewal_links;
CREATE POLICY "renewal_links_service_all"
ON public.org_renewal_links FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "renewal_links_owner_read" ON public.org_renewal_links;
CREATE POLICY "renewal_links_owner_read"
ON public.org_renewal_links FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.org_memberships m
  WHERE m.org_id = org_renewal_links.org_id
    AND m.user_id = auth.uid()
    AND m.role IN ('owner','admin')
    AND m.status = 'active'
));

CREATE OR REPLACE FUNCTION public.org_create_self_service_renewal_link(
  p_license_id uuid,
  p_ttl_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license public.org_licenses;
  v_token text;
  v_link_id uuid;
BEGIN
  SELECT * INTO v_license FROM public.org_licenses WHERE id = p_license_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'license_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships
    WHERE org_id = v_license.org_id
      AND user_id = auth.uid()
      AND role IN ('owner','admin')
      AND status = 'active'
  ) AND NOT has_role(auth.uid(),'admin'::app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_token := encode(gen_random_bytes(24),'hex');

  INSERT INTO public.org_renewal_links(license_id, org_id, created_by, token, expires_at, metadata)
  VALUES (
    p_license_id,
    v_license.org_id,
    auth.uid(),
    v_token,
    now() + make_interval(days => GREATEST(1, COALESCE(p_ttl_days, 30))),
    jsonb_build_object(
      'product_id', v_license.product_id,
      'seat_count', v_license.seat_count,
      'category', v_license.category
    )
  )
  RETURNING id INTO v_link_id;

  RETURN jsonb_build_object(
    'ok', true,
    'link_id', v_link_id,
    'token', v_token,
    'url', 'https://examfit.de/renew?token=' || v_token,
    'expires_at', now() + make_interval(days => GREATEST(1, COALESCE(p_ttl_days, 30)))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.org_create_self_service_renewal_link(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_create_self_service_renewal_link(uuid,int) TO authenticated;

-- ============================================================
-- 3) VARIANT-AWARE PAYWALL NOTIFY
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_resolve_user_paywall_variant(
  p_user_id uuid,
  p_experiment_key text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pv.variant_key
  FROM public.experiment_assignments ea
  JOIN public.paywall_variants pv ON pv.id = ea.variant_id
  JOIN public.paywall_experiments pe ON pe.id = ea.experiment_id
  WHERE ea.user_id = p_user_id
    AND (p_experiment_key IS NULL OR pe.experiment_key = p_experiment_key)
  ORDER BY ea.assigned_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE VIEW public.v_paywall_variant_attribution_drift AS
SELECT
  date_trunc('day', nj.created_at) AS day,
  count(*) FILTER (WHERE nj.payload ? 'variant_key') AS with_variant,
  count(*) FILTER (WHERE NOT (nj.payload ? 'variant_key')) AS without_variant,
  count(*) AS total,
  round(
    100.0 * count(*) FILTER (WHERE nj.payload ? 'variant_key')::numeric
    / NULLIF(count(*),0),
    1
  ) AS coverage_pct
FROM public.notification_jobs nj
WHERE nj.kind = 'paywall_abandoned'
  AND nj.created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1 DESC;

REVOKE ALL ON public.v_paywall_variant_attribution_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_paywall_variant_attribution_drift TO service_role;

-- ============================================================
-- 4) ORG-PREFERENCE CENTER
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_owner_digest_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cadence text NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly','monthly','disabled')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_digest_prefs_org ON public.org_owner_digest_preferences(org_id);

ALTER TABLE public.org_owner_digest_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digest_prefs_owner_select" ON public.org_owner_digest_preferences;
CREATE POLICY "digest_prefs_owner_select"
ON public.org_owner_digest_preferences FOR SELECT TO authenticated
USING (owner_user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "digest_prefs_service_all" ON public.org_owner_digest_preferences;
CREATE POLICY "digest_prefs_service_all"
ON public.org_owner_digest_preferences FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.org_owner_update_digest_preference(
  p_org_id uuid,
  p_cadence text,
  p_enabled boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cadence NOT IN ('weekly','monthly','disabled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cadence');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND role IN ('owner','admin')
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  INSERT INTO public.org_owner_digest_preferences(org_id, owner_user_id, cadence, enabled)
  VALUES (p_org_id, auth.uid(), p_cadence, p_enabled)
  ON CONFLICT (org_id, owner_user_id)
  DO UPDATE SET cadence = EXCLUDED.cadence, enabled = EXCLUDED.enabled, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'org_id', p_org_id, 'cadence', p_cadence, 'enabled', p_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.org_owner_update_digest_preference(uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_owner_update_digest_preference(uuid,text,boolean) TO authenticated;

-- ============================================================
-- 5) ADMIN AUDIT + SMOKE
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_track_m7_audit(p_window_hours int DEFAULT 168)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'reverse_paid_suppressed_count', (
      SELECT count(*) FROM public.auto_heal_log
      WHERE action_type = 'm7_checkout_abandoned_reversed'
        AND created_at >= now() - make_interval(hours => p_window_hours)
    ),
    'renewal_links_total', (SELECT count(*) FROM public.org_renewal_links),
    'renewal_links_active', (
      SELECT count(*) FROM public.org_renewal_links
      WHERE used_at IS NULL AND expires_at > now()
    ),
    'paywall_jobs_with_variant', (
      SELECT count(*) FROM public.notification_jobs
      WHERE kind = 'paywall_abandoned'
        AND created_at >= now() - make_interval(hours => p_window_hours)
        AND payload ? 'variant_key'
    ),
    'paywall_jobs_without_variant', (
      SELECT count(*) FROM public.notification_jobs
      WHERE kind = 'paywall_abandoned'
        AND created_at >= now() - make_interval(hours => p_window_hours)
        AND NOT (payload ? 'variant_key')
    ),
    'digest_prefs_weekly', (SELECT count(*) FROM public.org_owner_digest_preferences WHERE cadence='weekly' AND enabled),
    'digest_prefs_monthly', (SELECT count(*) FROM public.org_owner_digest_preferences WHERE cadence='monthly' AND enabled),
    'digest_prefs_disabled', (SELECT count(*) FROM public.org_owner_digest_preferences WHERE cadence='disabled' OR NOT enabled),
    'window_hours', p_window_hours
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_track_m7_audit(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_track_m7_audit(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_smoke_track_m7()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'trigger_reverse_exists', EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_m7_reverse_checkout_abandoned'
    ),
    'renewal_rpc_exists', EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'org_create_self_service_renewal_link'
    ),
    'variant_helper_exists', EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'fn_resolve_user_paywall_variant'
    ),
    'prefs_table_exists', EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='org_owner_digest_preferences'
    ),
    'drift_view_exists', EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema='public' AND table_name='v_paywall_variant_attribution_drift'
    )
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_smoke_track_m7() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_smoke_track_m7() TO authenticated;
