
-- Migration 1: Occupational Intelligence Bridge — SSOT-Normalisierung
-- Extends bestehende SSOTs (vertical_dna, certification_catalog, vertical_subscriptions).
-- Erstellt KEINE neuen Tabellen. Bridge-Identifier-Vertrag: vertical_slug.

-- 1.1 vertical_dna: stabiler Bridge-Identifier vertical_slug
ALTER TABLE public.vertical_dna
  ADD COLUMN IF NOT EXISTS vertical_slug TEXT;

-- Backfill bestehende 10 Rows aus industry_key (deterministisches Primary-Mapping)
UPDATE public.vertical_dna SET vertical_slug = CASE industry_key
  WHEN 'public_admin' THEN 'verwaltung'
  WHEN 'healthcare'   THEN 'praxis'
  WHEN 'real_estate'  THEN 'makler'
  WHEN 'crafts'       THEN 'handwerk'
  WHEN 'funding'      THEN 'foerdermittel'
  WHEN 'hr'           THEN 'hr'
  WHEN 'banking'      THEN 'banking'
  WHEN 'consulting'   THEN 'consulting'
  WHEN 'support'      THEN 'support'
  WHEN 'education'    THEN 'education'
  ELSE industry_key
END
WHERE vertical_slug IS NULL;

-- UNIQUE-Constraint (Bridge-Identifier muss eindeutig sein)
CREATE UNIQUE INDEX IF NOT EXISTS ux_vertical_dna_vertical_slug
  ON public.vertical_dna (vertical_slug)
  WHERE vertical_slug IS NOT NULL;

-- Immutable-Trigger: vertical_slug darf nach Set NIE geändert werden (Bridge-Stabilität)
CREATE OR REPLACE FUNCTION public.fn_guard_vertical_dna_slug_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.vertical_slug IS NOT NULL
     AND NEW.vertical_slug IS DISTINCT FROM OLD.vertical_slug THEN
    RAISE EXCEPTION 'vertical_dna.vertical_slug is immutable (was %, attempted %)',
      OLD.vertical_slug, NEW.vertical_slug
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vertical_dna_slug_immutable ON public.vertical_dna;
CREATE TRIGGER trg_vertical_dna_slug_immutable
  BEFORE UPDATE ON public.vertical_dna
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_vertical_dna_slug_immutable();

-- 1.2 certification_catalog: Vertical-Mehrfachzuordnung (Cert kann mehreren Verticals dienen)
ALTER TABLE public.certification_catalog
  ADD COLUMN IF NOT EXISTS vertical_slugs TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_certification_catalog_vertical_slugs
  ON public.certification_catalog USING GIN (vertical_slugs);

-- 1.3 vertical_subscriptions: CHECK-Constraint gegen Free-Text-Drift
-- Erst entfernen falls existiert, dann neu setzen mit canonical 11-Slug Allowlist
ALTER TABLE public.vertical_subscriptions
  DROP CONSTRAINT IF EXISTS vertical_subscriptions_vertical_slug_check;

ALTER TABLE public.vertical_subscriptions
  ADD CONSTRAINT vertical_subscriptions_vertical_slug_check
  CHECK (vertical_slug IN (
    'praxis','steuer','verwaltung','notar','handwerk',
    'gartenbau','pflege','krankenkasse','kanzlei','makler','foerdermittel'
  ));

COMMENT ON COLUMN public.vertical_dna.vertical_slug IS
  'Bridge-Identifier zum Vertical-Packaging (verticals.ts industryKey). Immutable nach Set. UNIQUE.';
COMMENT ON COLUMN public.certification_catalog.vertical_slugs IS
  'Zuordnung dieses Zertifikats zu Vertical-Slugs (n:m). Backfill via Slug-Pattern.';
