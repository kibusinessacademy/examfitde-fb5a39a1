
-- ═══════════════════════════════════════════════════════════
-- Phase 2: Content Studio DB Schema
-- content_pages, blog_posts, content_assets, seo_redirects
-- ═══════════════════════════════════════════════════════════

-- 1) Content Pages (Landing pages, product pages, legal, FAQ, impressum)
CREATE TABLE IF NOT EXISTS public.content_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  page_type TEXT NOT NULL DEFAULT 'landing', -- landing, product, legal, faq, impressum
  title TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  body_md TEXT DEFAULT '',
  schema_json JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
  language TEXT DEFAULT 'de',
  audience TEXT DEFAULT 'azubi', -- azubi, betrieb, institutionen, alle
  og_image_url TEXT,
  noindex BOOLEAN DEFAULT false,
  created_by UUID,
  updated_by UUID,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access on content_pages" ON public.content_pages FOR ALL USING (true) WITH CHECK (true);

-- 2) Blog Posts
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  excerpt TEXT,
  body_md TEXT DEFAULT '',
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  internal_links JSONB DEFAULT '[]',
  schema_json JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
  author_name TEXT,
  og_image_url TEXT,
  canonical_url TEXT,
  noindex BOOLEAN DEFAULT false,
  created_by UUID,
  updated_by UUID,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access on blog_posts" ON public.blog_posts FOR ALL USING (true) WITH CHECK (true);

-- 3) Content Assets (images, files with SEO metadata)
CREATE TABLE IF NOT EXISTS public.content_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT,
  alt_text TEXT,
  caption TEXT,
  keywords TEXT[] DEFAULT '{}',
  license TEXT,
  source_url TEXT,
  used_on_pages TEXT[] DEFAULT '{}',
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access on content_assets" ON public.content_assets FOR ALL USING (true) WITH CHECK (true);

-- 4) SEO Redirects
CREATE TABLE IF NOT EXISTS public.seo_redirects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_path TEXT NOT NULL UNIQUE,
  to_path TEXT NOT NULL,
  status_code INT NOT NULL DEFAULT 301 CHECK (status_code IN (301, 302)),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.seo_redirects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access on seo_redirects" ON public.seo_redirects FOR ALL USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_content_pages_updated_at BEFORE UPDATE ON public.content_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_blog_posts_updated_at BEFORE UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_content_assets_updated_at BEFORE UPDATE ON public.content_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_seo_redirects_updated_at BEFORE UPDATE ON public.seo_redirects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.content_pages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.blog_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.content_assets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.seo_redirects;
