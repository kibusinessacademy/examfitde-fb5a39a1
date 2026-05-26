
CREATE TABLE IF NOT EXISTS public.marketing_product_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  hero_kicker text,
  hero_headline text NOT NULL,
  hero_subline text,
  product_intro text,
  usps jsonb NOT NULL DEFAULT '[]'::jsonb,
  faqs jsonb NOT NULL DEFAULT '[]'::jsonb,
  trust_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  changelog jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_primary_label text,
  cta_primary_url text,
  cta_secondary_label text,
  cta_secondary_url text,
  persona_cta_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo_title text,
  seo_description text,
  seo_canonical text,
  seo_og_image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

GRANT SELECT ON public.marketing_product_pages TO anon, authenticated;
GRANT ALL ON public.marketing_product_pages TO service_role;

ALTER TABLE public.marketing_product_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketing_product_pages_public_read_published"
  ON public.marketing_product_pages
  FOR SELECT
  USING (status = 'published');

CREATE POLICY "marketing_product_pages_admin_all"
  ON public.marketing_product_pages
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_marketing_product_pages_updated_at
  BEFORE UPDATE ON public.marketing_product_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_marketing_product_pages_status ON public.marketing_product_pages(status);
