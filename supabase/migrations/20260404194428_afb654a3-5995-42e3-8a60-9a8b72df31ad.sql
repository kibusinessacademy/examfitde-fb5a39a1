
-- View 1: License overview
CREATE OR REPLACE VIEW public.v_admin_standalone_licenses AS
SELECT
  sl.id,
  sl.license_id,
  sl.email,
  sl.course_id,
  c.title AS course_title,
  sl.package_id,
  cp.title AS package_title,
  sl.status,
  sl.device_limit,
  sl.expires_at,
  sl.last_validated_at,
  sl.last_opened_at,
  sl.created_at AS issued_at,
  sl.metadata,
  COALESCE(dev.device_count, 0) AS device_count,
  dev.last_seen_at,
  CASE
    WHEN sl.status IN ('revoked','suspended') THEN 'critical'
    WHEN sl.expires_at <= now() THEN 'critical'
    WHEN COALESCE(dev.device_count, 0) > sl.device_limit THEN 'critical'
    WHEN COALESCE(dev.device_count, 0) = sl.device_limit THEN 'warning'
    ELSE 'ok'
  END AS risk_level
FROM public.standalone_licenses sl
JOIN public.courses c ON c.id = sl.course_id
JOIN public.course_packages cp ON cp.id = sl.package_id
LEFT JOIN (
  SELECT
    license_id,
    COUNT(DISTINCT device_fingerprint)::int AS device_count,
    MAX(last_seen_at) AS last_seen_at
  FROM public.standalone_license_devices
  GROUP BY license_id
) dev ON dev.license_id = sl.license_id;

-- View 2: Device history
CREATE OR REPLACE VIEW public.v_admin_standalone_license_devices AS
SELECT
  sld.id,
  sld.license_id,
  sl.email,
  sl.course_id,
  c.title AS course_title,
  sl.package_id,
  cp.title AS package_title,
  sld.device_fingerprint,
  sld.created_at AS first_seen_at,
  sld.last_seen_at,
  sld.metadata
FROM public.standalone_license_devices sld
JOIN public.standalone_licenses sl ON sl.license_id = sld.license_id
JOIN public.courses c ON c.id = sl.course_id
JOIN public.course_packages cp ON cp.id = sl.package_id;

-- View 3: Event feed
CREATE OR REPLACE VIEW public.v_admin_standalone_license_events AS
SELECT
  sle.id,
  sle.license_id,
  sl.email,
  sl.course_id,
  c.title AS course_title,
  sl.package_id,
  cp.title AS package_title,
  sle.event_type,
  sle.event_status,
  sle.detail,
  sle.created_at
FROM public.standalone_license_events sle
JOIN public.standalone_licenses sl ON sl.license_id = sle.license_id
JOIN public.courses c ON c.id = sl.course_id
JOIN public.course_packages cp ON cp.id = sl.package_id;

-- View 4: Risk board
CREATE OR REPLACE VIEW public.v_admin_standalone_license_risk AS
SELECT
  sl.license_id,
  sl.email,
  c.title AS course_title,
  cp.title AS package_title,
  sl.status,
  sl.device_limit,
  COUNT(DISTINCT sld.device_fingerprint)::int AS device_count,
  MAX(sld.last_seen_at) AS last_seen_at,
  CASE
    WHEN sl.status IN ('revoked','suspended') THEN 'critical'
    WHEN COUNT(DISTINCT sld.device_fingerprint) > sl.device_limit THEN 'critical'
    WHEN COUNT(DISTINCT sld.device_fingerprint) = sl.device_limit THEN 'warning'
    ELSE 'ok'
  END AS risk_level
FROM public.standalone_licenses sl
JOIN public.courses c ON c.id = sl.course_id
JOIN public.course_packages cp ON cp.id = sl.package_id
LEFT JOIN public.standalone_license_devices sld ON sld.license_id = sl.license_id
GROUP BY sl.license_id, sl.email, c.title, cp.title, sl.status, sl.device_limit;

-- Lock views to service_role only
REVOKE SELECT ON public.v_admin_standalone_licenses FROM anon, authenticated;
REVOKE SELECT ON public.v_admin_standalone_license_devices FROM anon, authenticated;
REVOKE SELECT ON public.v_admin_standalone_license_events FROM anon, authenticated;
REVOKE SELECT ON public.v_admin_standalone_license_risk FROM anon, authenticated;
