
-- =====================================================================
-- Identity-Contract Hard-Block für conversion_events (Path B, P0-Gate)
-- =====================================================================
-- Write-time enforcement: strict events MÜSSEN package_id haben.
-- Ausnahmen nur via metadata.allow_missing_package_id=true ODER
-- smoke_test=true / simulation=true (für E2E + Audit-Simulator).
-- Audit-Sink: conversion_event_violations (für Transparenz statt silent kill).

-- 1) Audit-Tabelle
CREATE TABLE IF NOT EXISTS public.conversion_event_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  attempted_metadata jsonb,
  attempted_user_id uuid,
  attempted_session_id text,
  reason text NOT NULL DEFAULT 'IDENTITY_CONTRACT_VIOLATION',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversion_event_violations ENABLE ROW LEVEL SECURITY;

-- Nur service_role darf lesen/schreiben (admin via RPC)
REVOKE ALL ON public.conversion_event_violations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.conversion_event_violations TO service_role;

CREATE INDEX IF NOT EXISTS idx_conversion_event_violations_created_at
  ON public.conversion_event_violations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversion_event_violations_event_type
  ON public.conversion_event_violations (event_type, created_at DESC);

-- 2) Guard-Funktion
CREATE OR REPLACE FUNCTION public.fn_guard_conversion_event_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean := false;
  v_is_smoke boolean := false;
  v_is_sim boolean := false;
BEGIN
  -- Nur strict events betroffen (kanonisch laut SSOT v1)
  IF NEW.event_type IN (
    'checkout_started',
    'checkout_complete',
    'checkout_completed',  -- Legacy-Alias, soll ebenfalls geblockt werden
    'lead_capture_submitted',
    'quiz_started',
    'quiz_completed'
  ) THEN
    -- 1. Hauptregel: package_id MUSS gesetzt sein
    IF NEW.package_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- 2. Whitelist-Ausnahmen (E2E / Simulator / explizit erlaubt)
    v_allowed  := COALESCE((NEW.metadata->>'allow_missing_package_id')::boolean, false);
    v_is_smoke := COALESCE((NEW.metadata->>'smoke_test')::boolean, false);
    v_is_sim   := COALESCE((NEW.metadata->>'simulation')::boolean, false);

    IF v_allowed OR v_is_smoke OR v_is_sim THEN
      RETURN NEW;
    END IF;

    -- 3. Audit + Block
    BEGIN
      INSERT INTO public.conversion_event_violations
        (event_type, attempted_metadata, attempted_user_id, attempted_session_id, reason)
      VALUES
        (NEW.event_type, NEW.metadata, NEW.user_id, NEW.session_id,
         'IDENTITY_CONTRACT_VIOLATION: package_id required');
    EXCEPTION WHEN OTHERS THEN
      -- Audit-Insert darf den Block nicht verschlucken
      NULL;
    END;

    RAISE EXCEPTION 'IDENTITY_CONTRACT_VIOLATION: package_id is required for event_type=%', NEW.event_type
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Trigger
DROP TRIGGER IF EXISTS trg_guard_conversion_event_identity ON public.conversion_events;

CREATE TRIGGER trg_guard_conversion_event_identity
BEFORE INSERT ON public.conversion_events
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_conversion_event_identity();

-- 4) Admin-RPC für Violations-Read (statt direkter View-Grant)
CREATE OR REPLACE FUNCTION public.admin_get_conversion_event_violations(
  p_hours integer DEFAULT 24,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  event_type text,
  attempted_metadata jsonb,
  attempted_user_id uuid,
  attempted_session_id text,
  reason text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT v.id, v.event_type, v.attempted_metadata, v.attempted_user_id,
         v.attempted_session_id, v.reason, v.created_at
  FROM public.conversion_event_violations v
  WHERE v.created_at > now() - make_interval(hours => GREATEST(1, p_hours))
  ORDER BY v.created_at DESC
  LIMIT GREATEST(1, LEAST(1000, p_limit));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_conversion_event_violations(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_conversion_event_violations(integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_guard_conversion_event_identity() IS
  'Identity-Contract Hard-Block (P0-Gate): conversion_events ohne package_id für strict events werden geblockt + in conversion_event_violations geloggt. Whitelist: metadata.allow_missing_package_id|smoke_test|simulation = true.';

COMMENT ON TABLE public.conversion_event_violations IS
  'Audit-Sink für vom Identity-Contract Hard-Block abgewiesene Insert-Versuche. service_role only; UI via admin_get_conversion_event_violations(p_hours,p_limit).';
