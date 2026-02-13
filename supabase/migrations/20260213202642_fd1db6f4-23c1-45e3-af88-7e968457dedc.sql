
-- ═══════════════════════════════════════════════════════════════════════════════
-- HYBRID TARGET ENGINE — Neue Felder auf certification_catalog
-- ═══════════════════════════════════════════════════════════════════════════════

-- Neue Hybrid-Target-Felder
ALTER TABLE public.certification_catalog
  ADD COLUMN IF NOT EXISTS exam_complexity_score numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS math_ratio numeric DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS oral_component boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS learning_field_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS written_exam_weight numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS certification_level text DEFAULT 'ausbildung';

-- Kommentare für Dokumentation
COMMENT ON COLUMN public.certification_catalog.exam_complexity_score IS 'Komplexitätsfaktor (1.0 = Standard, 1.5 = komplex wie Fachwirt)';
COMMENT ON COLUMN public.certification_catalog.math_ratio IS 'Anteil Rechenaufgaben (0.0 - 1.0)';
COMMENT ON COLUMN public.certification_catalog.oral_component IS 'Hat mündliche Prüfungskomponente';
COMMENT ON COLUMN public.certification_catalog.learning_field_count IS 'Anzahl Lernfelder/Domänen';
COMMENT ON COLUMN public.certification_catalog.written_exam_weight IS 'Gewichtung schriftliche Prüfung (0.0 - 1.0)';
COMMENT ON COLUMN public.certification_catalog.certification_level IS 'ausbildung | fachwirt | meister | sachkunde | projektmanagement';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEO: Neue Tabelle für programmatic SEO-Seiten pro Zertifizierung
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.certification_seo_pages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  certification_catalog_id uuid REFERENCES public.certification_catalog(id) ON DELETE CASCADE,
  page_type text NOT NULL, -- 'landing' | 'pruefungsstruktur' | 'durchfallquote' | 'schweregrad' | 'faq' | 'vergleich' | 'simulation'
  slug text NOT NULL,
  title text NOT NULL,
  meta_title text,
  meta_description text,
  content_html text,
  content_json jsonb,
  is_published boolean DEFAULT false,
  published_at timestamptz,
  quality_score numeric DEFAULT 0,
  word_count integer DEFAULT 0,
  internal_links jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(certification_catalog_id, page_type)
);

-- Index für schnelle Slug-Lookups
CREATE INDEX IF NOT EXISTS idx_cert_seo_pages_slug ON public.certification_seo_pages(slug);
CREATE INDEX IF NOT EXISTS idx_cert_seo_pages_published ON public.certification_seo_pages(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_cert_seo_pages_type ON public.certification_seo_pages(page_type);

-- RLS
ALTER TABLE public.certification_seo_pages ENABLE ROW LEVEL SECURITY;

-- Public read for published pages (SEO)
CREATE POLICY "Published SEO pages are publicly readable"
  ON public.certification_seo_pages FOR SELECT
  USING (is_published = true);

-- Service role can manage all
CREATE POLICY "Service role manages certification SEO pages"
  ON public.certification_seo_pages FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE TRIGGER update_certification_seo_pages_updated_at
  BEFORE UPDATE ON public.certification_seo_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
