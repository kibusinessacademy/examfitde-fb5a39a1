
-- ══════════════════════════════════════════════════════════════
-- 1. standalone_licenses
-- ══════════════════════════════════════════════════════════════
CREATE TABLE public.standalone_licenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  course_id UUID NOT NULL,
  package_id UUID NOT NULL,
  curriculum_id UUID,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  device_limit INTEGER NOT NULL DEFAULT 3,
  expires_at TIMESTAMPTZ NOT NULL,
  last_validated_at TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT standalone_licenses_status_check CHECK (status IN ('active','revoked','expired','suspended'))
);

CREATE INDEX idx_standalone_licenses_status ON public.standalone_licenses(status);
CREATE INDEX idx_standalone_licenses_course ON public.standalone_licenses(course_id);
CREATE INDEX idx_standalone_licenses_email ON public.standalone_licenses(email);

ALTER TABLE public.standalone_licenses ENABLE ROW LEVEL SECURITY;

-- Only service_role (edge functions) can access
CREATE POLICY "Service role full access on standalone_licenses"
  ON public.standalone_licenses FOR ALL
  USING (true) WITH CHECK (true);

-- Revoke anon/authenticated so only service_role passes
REVOKE ALL ON public.standalone_licenses FROM anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. standalone_license_devices
-- ══════════════════════════════════════════════════════════════
CREATE TABLE public.standalone_license_devices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES public.standalone_licenses(license_id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id, device_fingerprint)
);

CREATE INDEX idx_standalone_license_devices_license ON public.standalone_license_devices(license_id);

ALTER TABLE public.standalone_license_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on standalone_license_devices"
  ON public.standalone_license_devices FOR ALL
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.standalone_license_devices FROM anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. standalone_license_events (append-only audit log)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE public.standalone_license_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES public.standalone_licenses(license_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_status TEXT NOT NULL DEFAULT 'ok',
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_standalone_license_events_license ON public.standalone_license_events(license_id);
CREATE INDEX idx_standalone_license_events_type ON public.standalone_license_events(event_type);

ALTER TABLE public.standalone_license_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on standalone_license_events"
  ON public.standalone_license_events FOR ALL
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.standalone_license_events FROM anon, authenticated;

-- Append-only guard: no updates or deletes on events
CREATE OR REPLACE FUNCTION public.trg_guard_license_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'standalone_license_events is append-only';
END;
$$;

CREATE TRIGGER trg_license_events_no_update
  BEFORE UPDATE ON public.standalone_license_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_license_events_immutable();

CREATE TRIGGER trg_license_events_no_delete
  BEFORE DELETE ON public.standalone_license_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_license_events_immutable();

-- ══════════════════════════════════════════════════════════════
-- 4. Risk view
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_standalone_license_risk AS
SELECT
  sl.license_id,
  sl.email,
  sl.status,
  sl.device_limit,
  sl.expires_at,
  sl.last_validated_at,
  count(DISTINCT sld.device_fingerprint) AS device_count,
  max(sld.last_seen_at) AS last_device_seen,
  CASE
    WHEN count(DISTINCT sld.device_fingerprint) > sl.device_limit THEN 'critical'
    WHEN count(DISTINCT sld.device_fingerprint) = sl.device_limit THEN 'warning'
    ELSE 'ok'
  END AS risk_level
FROM public.standalone_licenses sl
LEFT JOIN public.standalone_license_devices sld
  ON sld.license_id = sl.license_id
GROUP BY sl.license_id, sl.email, sl.status, sl.device_limit, sl.expires_at, sl.last_validated_at;

-- Restrict view to service_role only
REVOKE ALL ON public.v_standalone_license_risk FROM anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5. updated_at trigger reuse
-- ══════════════════════════════════════════════════════════════
CREATE TRIGGER update_standalone_licenses_updated_at
  BEFORE UPDATE ON public.standalone_licenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_standalone_license_devices_updated_at
  BEFORE UPDATE ON public.standalone_license_devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
