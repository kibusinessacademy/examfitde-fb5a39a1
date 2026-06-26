
CREATE TABLE IF NOT EXISTS public.beruf_image_cache (
  slug text PRIMARY KEY,
  title text,
  kammer text,
  image_url text,
  status text NOT NULL DEFAULT 'pending',
  generated_at timestamptz,
  error text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.beruf_image_cache TO anon, authenticated;
GRANT ALL ON public.beruf_image_cache TO service_role;
ALTER TABLE public.beruf_image_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read beruf images" ON public.beruf_image_cache;
CREATE POLICY "public read beruf images" ON public.beruf_image_cache FOR SELECT USING (true);
