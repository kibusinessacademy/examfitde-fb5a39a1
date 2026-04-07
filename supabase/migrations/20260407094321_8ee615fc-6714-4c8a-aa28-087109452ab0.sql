-- Add answer-first / AI-search columns to blog_articles
ALTER TABLE public.blog_articles
  ADD COLUMN IF NOT EXISTS article_type text DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS primary_question text,
  ADD COLUMN IF NOT EXISTS short_answer text,
  ADD COLUMN IF NOT EXISTS answer_blocks jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS entity_data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS content_quality_signals jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS speakable_selectors text[] DEFAULT ARRAY['.short-answer', 'h1', '.definition-block'],
  ADD COLUMN IF NOT EXISTS beruf_id uuid,
  ADD COLUMN IF NOT EXISTS competency_id uuid,
  ADD COLUMN IF NOT EXISTS internal_link_plan jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_priority integer DEFAULT 0;

-- Add comment for article_type values
COMMENT ON COLUMN public.blog_articles.article_type IS 'definition | mistake | example | comparison | faq | strategy | general';

-- Index for entity-based queries
CREATE INDEX IF NOT EXISTS idx_blog_articles_beruf ON public.blog_articles(beruf_id) WHERE beruf_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blog_articles_competency ON public.blog_articles(competency_id) WHERE competency_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blog_articles_type ON public.blog_articles(article_type);
CREATE INDEX IF NOT EXISTS idx_blog_articles_status_published ON public.blog_articles(status, published_at DESC) WHERE status = 'published';

-- Ensure RLS is enabled (should already be)
ALTER TABLE public.blog_articles ENABLE ROW LEVEL SECURITY;

-- Public read access for published articles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'blog_articles' AND policyname = 'Public can read published blog articles') THEN
    CREATE POLICY "Public can read published blog articles"
      ON public.blog_articles FOR SELECT
      USING (status = 'published');
  END IF;
END $$;