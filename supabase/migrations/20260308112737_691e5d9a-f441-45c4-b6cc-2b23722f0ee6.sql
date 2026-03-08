
DROP INDEX IF EXISTS qualification_catalog_canonical_slug_key;
ALTER TABLE public.qualification_catalog
  ADD CONSTRAINT qualification_catalog_canonical_slug_unique UNIQUE (canonical_slug);
