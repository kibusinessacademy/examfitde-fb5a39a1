-- Patch 1: conversion_events.package_id als generated column aus metadata->>'package_id'
-- Vorprüfung bestätigt: 0 invalid UUIDs in metadata.package_id (15 NULL-Werte, 37 ohne Key)

-- Helper: sichere UUID-Projektion (NULL bei nicht-UUID statt Crash)
CREATE OR REPLACE FUNCTION public.safe_uuid_from_text(p_text text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN RETURN NULL; END IF;
  RETURN p_text::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Generated column als STORED (für Indexierung)
ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS package_id uuid
  GENERATED ALWAYS AS (public.safe_uuid_from_text(metadata->>'package_id')) STORED;

-- Index für Reporting/Joins
CREATE INDEX IF NOT EXISTS idx_conversion_events_package_id
  ON public.conversion_events(package_id)
  WHERE package_id IS NOT NULL;

-- Composite-Index für Funnel-Queries (event_type + package_id + created_at)
CREATE INDEX IF NOT EXISTS idx_conversion_events_event_package_created
  ON public.conversion_events(event_type, package_id, created_at DESC)
  WHERE package_id IS NOT NULL;

-- Comment dokumentiert SSOT
COMMENT ON COLUMN public.conversion_events.package_id IS
  'SSOT generated column from metadata->>package_id. metadata.package_id bleibt erhalten für Backwards-Kompatibilität. Top-level package_id ist der bevorzugte Read-Pfad für Guards/Reports/Smoke-Tests.';