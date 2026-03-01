
-- ============================================================
-- BerufsKI Schema – Autonome Produktschiene für KI im Berufsalltag
-- ============================================================

-- 1. Berufs-DNA Tabelle (Herzstück)
CREATE TABLE public.berufski_berufe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  branche text,
  typische_aufgaben text[] DEFAULT '{}',
  dokumenttypen text[] DEFAULT '{}',
  pain_points text[] DEFAULT '{}',
  haftungsrisiken text[] DEFAULT '{}',
  digitalisierungsgrad text DEFAULT 'mittel',
  seo_keywords text[] DEFAULT '{}',
  conversion_story text,
  examfit_curriculum_id uuid, -- optional link to existing ExamFit curriculum
  is_published boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Generierte Produkte
CREATE TABLE public.berufski_produkte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beruf_id uuid NOT NULL REFERENCES public.berufski_berufe(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('9', '19', '29')),
  titel text NOT NULL,
  landing_headline text,
  landing_subline text,
  landing_content text, -- markdown for SEO page
  pdf_content text,     -- generated content for PDF
  pdf_storage_path text, -- path in storage bucket
  seo_cluster jsonb DEFAULT '{}',
  meta_title text,
  meta_description text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'review', 'published', 'archived')),
  generation_model text,
  generation_cost_eur numeric(8,4) DEFAULT 0,
  stripe_price_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(beruf_id, tier)
);

-- 3. Käufe / Entitlements
CREATE TABLE public.berufski_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  produkt_id uuid NOT NULL REFERENCES public.berufski_produkte(id),
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount_cents integer NOT NULL,
  currency text DEFAULT 'eur',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'failed')),
  download_count integer DEFAULT 0,
  last_download_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 4. SEO Blog-Artikel (Cluster Engine)
CREATE TABLE public.berufski_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beruf_id uuid NOT NULL REFERENCES public.berufski_berufe(id) ON DELETE CASCADE,
  slug text NOT NULL,
  article_type text NOT NULL CHECK (article_type IN ('pillar', 'anwendung', 'praxisfall', 'fehler_vermeiden')),
  title text NOT NULL,
  body_md text,
  meta_title text,
  meta_description text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'published')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(beruf_id, slug)
);

-- Indexes
CREATE INDEX idx_berufski_berufe_published ON public.berufski_berufe(is_published) WHERE is_published = true;
CREATE INDEX idx_berufski_produkte_beruf ON public.berufski_produkte(beruf_id);
CREATE INDEX idx_berufski_produkte_status ON public.berufski_produkte(status) WHERE status = 'published';
CREATE INDEX idx_berufski_purchases_user ON public.berufski_purchases(user_id);
CREATE INDEX idx_berufski_purchases_produkt ON public.berufski_purchases(produkt_id);
CREATE INDEX idx_berufski_articles_beruf ON public.berufski_articles(beruf_id);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.berufski_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_berufski_berufe_updated
  BEFORE UPDATE ON public.berufski_berufe
  FOR EACH ROW EXECUTE FUNCTION public.berufski_set_updated_at();

CREATE TRIGGER trg_berufski_produkte_updated
  BEFORE UPDATE ON public.berufski_produkte
  FOR EACH ROW EXECUTE FUNCTION public.berufski_set_updated_at();

CREATE TRIGGER trg_berufski_articles_updated
  BEFORE UPDATE ON public.berufski_articles
  FOR EACH ROW EXECUTE FUNCTION public.berufski_set_updated_at();

-- ============================================================
-- RLS Policies
-- ============================================================

-- berufski_berufe: public read for published, admin write
ALTER TABLE public.berufski_berufe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published berufe"
  ON public.berufski_berufe FOR SELECT
  USING (is_published = true);

CREATE POLICY "Admins can manage berufe"
  ON public.berufski_berufe FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- berufski_produkte: public read for published, admin write
ALTER TABLE public.berufski_produkte ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published produkte"
  ON public.berufski_produkte FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admins can manage produkte"
  ON public.berufski_produkte FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- berufski_purchases: user reads own, admin reads all
ALTER TABLE public.berufski_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own purchases"
  ON public.berufski_purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all purchases"
  ON public.berufski_purchases FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service can insert purchases"
  ON public.berufski_purchases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- berufski_articles: public read for published, admin write
ALTER TABLE public.berufski_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published articles"
  ON public.berufski_articles FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admins can manage articles"
  ON public.berufski_articles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Storage bucket for PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('berufski-pdfs', 'berufski-pdfs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Purchasers can download their PDFs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'berufski-pdfs'
    AND EXISTS (
      SELECT 1 FROM public.berufski_purchases bp
      JOIN public.berufski_produkte bpr ON bpr.id = bp.produkt_id
      WHERE bp.user_id = auth.uid()
        AND bp.status = 'paid'
        AND bpr.pdf_storage_path = name
    )
  );

CREATE POLICY "Admins can manage PDFs"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'berufski-pdfs'
    AND public.has_role(auth.uid(), 'admin')
  );
