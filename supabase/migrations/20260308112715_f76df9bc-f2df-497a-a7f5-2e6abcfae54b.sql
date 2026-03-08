
ALTER TABLE public.qualification_catalog
  ADD COLUMN IF NOT EXISTS version_label text,
  ADD COLUMN IF NOT EXISTS version_date date,
  ADD COLUMN IF NOT EXISTS canonical_slug text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS qualification_catalog_canonical_slug_key
  ON public.qualification_catalog (canonical_slug)
  WHERE canonical_slug IS NOT NULL;
