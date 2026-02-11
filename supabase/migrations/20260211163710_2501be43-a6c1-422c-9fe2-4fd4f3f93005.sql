
-- Council 3: Marketing & SEO Council – Governance Layer

-- 1) Relax NOT NULL constraints for Council-managed fields
ALTER TABLE public.marketing_assets ALTER COLUMN content DROP NOT NULL;
ALTER TABLE public.marketing_assets ALTER COLUMN target_group DROP NOT NULL;

-- 2) Extend with Council v2 governance columns  
ALTER TABLE public.marketing_assets
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS target_audience text,
  ADD COLUMN IF NOT EXISTS certification_id uuid,
  ADD COLUMN IF NOT EXISTS course_id uuid,
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'de-DE',
  ADD COLUMN IF NOT EXISTS published_version_id uuid,
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_assets_slug_type_locale
  ON public.marketing_assets(asset_type, slug, locale)
  WHERE slug IS NOT NULL;

-- 3) Publish RPC
CREATE OR REPLACE FUNCTION public.publish_marketing_asset(
  p_asset_id uuid,
  p_version_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_decision text;
BEGIN
  SELECT status::text INTO v_status FROM public.content_versions WHERE id = p_version_id;
  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot publish version %, status=% (must be approved)', p_version_id, v_status;
  END IF;

  SELECT final_decision::text INTO v_decision FROM public.council_verdicts WHERE content_version_id = p_version_id;
  IF v_decision IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot publish version %, verdict=% (must be approved)', p_version_id, v_decision;
  END IF;

  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE public.marketing_assets
  SET published_version_id = p_version_id,
      is_published = true,
      updated_at = now()
  WHERE id = p_asset_id;
END $$;

-- 4) Guard trigger
CREATE OR REPLACE FUNCTION public.guard_publish_marketing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_bypass text;
  v_status text;
  v_decision text;
BEGIN
  v_bypass := current_setting('council.publish_bypass', true);
  IF v_bypass = 'true' THEN RETURN NEW; END IF;

  IF NEW.is_published = true AND (OLD.is_published IS DISTINCT FROM true) THEN
    IF NEW.published_version_id IS NULL THEN
      RAISE EXCEPTION 'Publish blocked: published_version_id is required';
    END IF;
    SELECT status::text INTO v_status FROM public.content_versions WHERE id = NEW.published_version_id;
    SELECT final_decision::text INTO v_decision FROM public.council_verdicts WHERE content_version_id = NEW.published_version_id;
    IF v_status IS DISTINCT FROM 'approved' OR v_decision IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'Publish blocked: version not approved (status=% verdict=%)', v_status, v_decision;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_publish_marketing ON public.marketing_assets;
CREATE TRIGGER trg_guard_publish_marketing
  BEFORE UPDATE ON public.marketing_assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_publish_marketing();

-- 5) Seed 3 landing pages
INSERT INTO public.marketing_assets (asset_type, slug, title, target_audience, target_group, locale, status)
VALUES
  ('landing_page', 'pruefungstraining-azubis', 'Prüfungstraining für Azubis', 'azubis', 'azubis', 'de-DE', 'draft'),
  ('landing_page', 'pruefungstraining-betriebe', 'Prüfungstraining für Betriebe', 'betriebe', 'betriebe', 'de-DE', 'draft'),
  ('landing_page', 'pruefungstraining-institutionen', 'Prüfungstraining für Institutionen', 'institutionen', 'institutionen', 'de-DE', 'draft')
ON CONFLICT DO NOTHING;
