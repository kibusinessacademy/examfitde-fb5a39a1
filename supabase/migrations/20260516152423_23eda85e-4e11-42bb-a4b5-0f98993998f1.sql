
-- ─────────────────────────────────────────────────────────────
-- Track M6 — Monetization Closure v3
-- ─────────────────────────────────────────────────────────────

-- 1. Email provider events (append-only audit)
CREATE TABLE IF NOT EXISTS public.email_provider_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL DEFAULT 'resend',
  event_type   text NOT NULL,
  email        text,
  message_id   text,
  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_provider_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "epe_service_all" ON public.email_provider_events;
CREATE POLICY "epe_service_all" ON public.email_provider_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "epe_admin_read" ON public.email_provider_events;
CREATE POLICY "epe_admin_read" ON public.email_provider_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_epe_ingested_at ON public.email_provider_events (ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_epe_event_type ON public.email_provider_events (event_type, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_epe_email ON public.email_provider_events (email);

-- 2. Ingest RPC: insert event + auto-suppress on bounce/complaint
CREATE OR REPLACE FUNCTION public.admin_ingest_resend_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type    text := lower(coalesce(p_event->>'type', ''));
  v_data    jsonb := coalesce(p_event->'data', '{}'::jsonb);
  v_email   text;
  v_msgid   text := v_data->>'email_id';
  v_emails  jsonb := v_data->'to';
  v_event_id uuid;
  v_suppressed boolean := false;
  v_reason  text;
BEGIN
  -- pick first recipient email
  IF jsonb_typeof(v_emails) = 'array' THEN
    v_email := lower(trim(v_emails->>0));
  ELSE
    v_email := lower(trim(coalesce(v_data->>'email', v_data->>'to', '')));
  END IF;
  IF v_email = '' THEN v_email := NULL; END IF;

  INSERT INTO public.email_provider_events (provider, event_type, email, message_id, raw)
  VALUES ('resend', v_type, v_email, v_msgid, p_event)
  RETURNING id INTO v_event_id;

  IF v_email IS NOT NULL AND v_type IN ('email.bounced', 'bounced', 'bounce', 'email.complained', 'complained', 'complaint') THEN
    v_reason := CASE
      WHEN v_type LIKE '%complain%' THEN 'complaint'
      ELSE 'bounce'
    END;
    INSERT INTO public.suppressed_emails (email, reason, metadata)
    VALUES (v_email, v_reason, jsonb_build_object('source', 'resend_webhook', 'event_id', v_event_id, 'message_id', v_msgid))
    ON CONFLICT (email) DO NOTHING;
    v_suppressed := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'type', v_type,
    'email', v_email,
    'suppressed', v_suppressed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ingest_resend_event(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ingest_resend_event(jsonb) TO service_role;

-- 3. Audit summary
CREATE OR REPLACE FUNCTION public.admin_get_track_m6_audit(p_window_hours int DEFAULT 168)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(hours => p_window_hours);
  v_events jsonb;
  v_suppressed_recent int;
  v_tuning_count int;
  v_tuning_enabled int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_object_agg(event_type, n) INTO v_events
  FROM (
    SELECT event_type, count(*) AS n
    FROM public.email_provider_events
    WHERE ingested_at >= v_since
    GROUP BY event_type
  ) s;

  SELECT count(*) INTO v_suppressed_recent
  FROM public.suppressed_emails
  WHERE created_at >= v_since
    AND coalesce(metadata->>'source', '') = 'resend_webhook';

  SELECT count(*), count(*) FILTER (WHERE enabled)
  INTO v_tuning_count, v_tuning_enabled
  FROM public.curriculum_upsell_promote_tuning;

  RETURN jsonb_build_object(
    'window_hours', p_window_hours,
    'provider_events', coalesce(v_events, '{}'::jsonb),
    'suppressed_via_webhook', v_suppressed_recent,
    'tuning_rows', v_tuning_count,
    'tuning_enabled_rows', v_tuning_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_track_m6_audit(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_track_m6_audit(int) TO authenticated;

-- 4. Smoke
CREATE OR REPLACE FUNCTION public.admin_smoke_track_m6()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingest_exists  boolean;
  v_table_exists   boolean;
  v_default_tuning boolean;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'admin_ingest_resend_event')
    INTO v_ingest_exists;
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'email_provider_events' AND relkind = 'r')
    INTO v_table_exists;
  SELECT EXISTS(SELECT 1 FROM public.curriculum_upsell_promote_tuning WHERE persona = '__default__' AND enabled)
    INTO v_default_tuning;

  RETURN jsonb_build_object(
    'ok', v_ingest_exists AND v_table_exists AND v_default_tuning,
    'ingest_rpc_exists', v_ingest_exists,
    'events_table_exists', v_table_exists,
    'default_tuning_enabled', v_default_tuning
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_smoke_track_m6() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_smoke_track_m6() TO authenticated;
