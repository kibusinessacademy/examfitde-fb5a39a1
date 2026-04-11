
-- =============================================
-- CMS TEMPLATES
-- =============================================
CREATE TABLE public.cms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  page_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  preview_image_url text,
  default_blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_settings_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cms_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cms_templates" ON public.cms_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- CMS PAGES
-- =============================================
CREATE TABLE public.cms_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  page_type text NOT NULL DEFAULT 'marketing_page',
  template_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  is_system_page boolean NOT NULL DEFAULT false,
  parent_page_id uuid REFERENCES public.cms_pages(id) ON DELETE SET NULL,
  excerpt text,
  seo_title text,
  meta_description text,
  og_title text,
  og_description text,
  og_image_url text,
  canonical_url text,
  robots text DEFAULT 'index,follow',
  schema_json jsonb,
  settings_json jsonb DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cms_pages" ON public.cms_pages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Published pages readable by everyone for frontend rendering
CREATE POLICY "Published pages are public" ON public.cms_pages FOR SELECT TO anon, authenticated USING (status = 'published');

CREATE INDEX idx_cms_pages_slug ON public.cms_pages (slug);
CREATE INDEX idx_cms_pages_type_status ON public.cms_pages (page_type, status);

-- =============================================
-- CMS PAGE BLOCKS
-- =============================================
CREATE TABLE public.cms_page_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.cms_pages(id) ON DELETE CASCADE,
  block_key text NOT NULL,
  block_type text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  styles_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cms_page_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cms_page_blocks" ON public.cms_page_blocks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Published page blocks readable for frontend
CREATE POLICY "Published page blocks are public" ON public.cms_page_blocks FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.cms_pages p WHERE p.id = page_id AND p.status = 'published'));

CREATE INDEX idx_cms_page_blocks_page ON public.cms_page_blocks (page_id, sort_order);

-- =============================================
-- CMS MEDIA
-- =============================================
CREATE TABLE public.cms_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  public_url text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  alt_text text,
  caption text,
  width int,
  height int,
  file_size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cms_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cms_media" ON public.cms_media FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Media publicly readable (images need to render on frontend)
CREATE POLICY "Media is publicly readable" ON public.cms_media FOR SELECT TO anon, authenticated USING (true);

-- =============================================
-- CMS PAGE VERSIONS
-- =============================================
CREATE TABLE public.cms_page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.cms_pages(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
ALTER TABLE public.cms_page_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cms_page_versions" ON public.cms_page_versions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_cms_page_versions_page ON public.cms_page_versions (page_id, version_number DESC);

-- =============================================
-- UPDATED_AT TRIGGERS
-- =============================================
CREATE TRIGGER update_cms_templates_updated_at BEFORE UPDATE ON public.cms_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_cms_pages_updated_at BEFORE UPDATE ON public.cms_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_cms_page_blocks_updated_at BEFORE UPDATE ON public.cms_page_blocks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- STORAGE BUCKET FOR CMS MEDIA
-- =============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('cms-media', 'cms-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins can upload cms media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cms-media' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update cms media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cms-media' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete cms media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cms-media' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "CMS media is publicly readable" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'cms-media');

-- =============================================
-- SEED: STANDARD TEMPLATES
-- =============================================
INSERT INTO public.cms_templates (template_key, name, description, page_type, default_blocks_json) VALUES
('homepage', 'Homepage', 'Standard-Startseite mit Hero, Finder, Berufe, Module, Trust, FAQ, CTA', 'marketing_page',
 '[{"block_key":"hero","block_type":"hero","sort_order":0,"content_json":{"headline":"","subline":"","cta_label":"","cta_url":""}},{"block_key":"finder","block_type":"search","sort_order":1,"content_json":{"headline":"Finde deinen Kurs"}},{"block_key":"popular","block_type":"card_grid","sort_order":2,"content_json":{"headline":"Beliebte Berufe","items":[]}},{"block_key":"how_it_works","block_type":"steps","sort_order":3,"content_json":{"headline":"So funktioniert''s","steps":[]}},{"block_key":"modules","block_type":"feature_list","sort_order":4,"content_json":{"headline":"Was ExamFit bietet","items":[]}},{"block_key":"audiences","block_type":"card_grid","sort_order":5,"content_json":{"headline":"Für wen ist ExamFit?","items":[]}},{"block_key":"trust","block_type":"trust_bar","sort_order":6,"content_json":{"items":[]}},{"block_key":"faq","block_type":"faq","sort_order":7,"content_json":{"headline":"Häufige Fragen","items":[]}},{"block_key":"final_cta","block_type":"cta","sort_order":8,"content_json":{"headline":"","cta_label":"","cta_url":""}}]'::jsonb),

('landing_page', 'Landingpage', 'Conversion-optimierte Landingpage mit Problem, Lösung, Vorteile, Trust, FAQ, CTA', 'landing_page',
 '[{"block_key":"hero","block_type":"hero","sort_order":0,"content_json":{"headline":"","subline":"","cta_label":"","cta_url":""}},{"block_key":"problem","block_type":"rich_text","sort_order":1,"content_json":{"headline":"Das Problem","body":""}},{"block_key":"solution","block_type":"rich_text","sort_order":2,"content_json":{"headline":"Die Lösung","body":""}},{"block_key":"benefits","block_type":"feature_list","sort_order":3,"content_json":{"headline":"Deine Vorteile","items":[]}},{"block_key":"trust","block_type":"trust_bar","sort_order":4,"content_json":{"items":[]}},{"block_key":"faq","block_type":"faq","sort_order":5,"content_json":{"headline":"Häufige Fragen","items":[]}},{"block_key":"final_cta","block_type":"cta","sort_order":6,"content_json":{"headline":"","cta_label":"","cta_url":""}}]'::jsonb),

('audience_page', 'Zielgruppen-Seite', 'Seite für spezifische Zielgruppe (Azubis, Betriebe, Berufsschulen)', 'marketing_page',
 '[{"block_key":"hero","block_type":"hero","sort_order":0,"content_json":{"headline":"","subline":"","cta_label":"","cta_url":""}},{"block_key":"pain","block_type":"rich_text","sort_order":1,"content_json":{"headline":"","body":""}},{"block_key":"benefits","block_type":"feature_list","sort_order":2,"content_json":{"headline":"","items":[]}},{"block_key":"how_it_works","block_type":"steps","sort_order":3,"content_json":{"headline":"So funktioniert''s","steps":[]}},{"block_key":"advantages","block_type":"card_grid","sort_order":4,"content_json":{"headline":"","items":[]}},{"block_key":"faq","block_type":"faq","sort_order":5,"content_json":{"headline":"Häufige Fragen","items":[]}},{"block_key":"final_cta","block_type":"cta","sort_order":6,"content_json":{"headline":"","cta_label":"","cta_url":""}}]'::jsonb),

('blog_article', 'Blogartikel', 'Standard-Blogartikel mit Titel, Intro, Inhalt, CTA, Related', 'blog_article',
 '[{"block_key":"article_header","block_type":"article_header","sort_order":0,"content_json":{"title":"","excerpt":"","cover_image_url":"","cover_image_alt":"","author":"ExamFit","published_at":"","categories":[],"tags":[]}},{"block_key":"intro","block_type":"rich_text","sort_order":1,"content_json":{"body":""}},{"block_key":"content_1","block_type":"rich_text","sort_order":2,"content_json":{"body":""}},{"block_key":"cta_box","block_type":"cta","sort_order":3,"content_json":{"headline":"","cta_label":"","cta_url":""}},{"block_key":"related","block_type":"related_articles","sort_order":4,"content_json":{"items":[]}}]'::jsonb),

('seo_guide', 'SEO-Ratgeber', 'Longform-SEO-Ratgeber mit Inhaltsverzeichnis, Content, FAQ, CTA', 'blog_article',
 '[{"block_key":"hero","block_type":"hero","sort_order":0,"content_json":{"headline":"","subline":""}},{"block_key":"toc","block_type":"table_of_contents","sort_order":1,"content_json":{}},{"block_key":"content_1","block_type":"rich_text","sort_order":2,"content_json":{"headline":"","body":""}},{"block_key":"content_2","block_type":"rich_text","sort_order":3,"content_json":{"headline":"","body":""}},{"block_key":"faq","block_type":"faq","sort_order":4,"content_json":{"headline":"Häufige Fragen","items":[]}},{"block_key":"cta","block_type":"cta","sort_order":5,"content_json":{"headline":"","cta_label":"","cta_url":""}},{"block_key":"related_topics","block_type":"card_grid","sort_order":6,"content_json":{"headline":"Verwandte Themen","items":[]}}]'::jsonb);
