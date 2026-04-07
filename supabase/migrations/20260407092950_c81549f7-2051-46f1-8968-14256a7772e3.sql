-- Add SEO + generation columns to blog_articles
ALTER TABLE public.blog_articles
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS hero_image_alt text,
  ADD COLUMN IF NOT EXISTS og_image_url text,
  ADD COLUMN IF NOT EXISTS internal_links_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_detection_score numeric,
  ADD COLUMN IF NOT EXISTS ai_detection_report jsonb,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS topic_cluster text,
  ADD COLUMN IF NOT EXISTS target_keyword text,
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS faq_json jsonb;

-- Unique slug constraint
DO $$ BEGIN
  ALTER TABLE public.blog_articles ADD CONSTRAINT blog_articles_slug_unique UNIQUE (slug);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Index for fast published queries
CREATE INDEX IF NOT EXISTS idx_blog_articles_status_published
  ON public.blog_articles (status, published_at DESC);

-- Index for topic cluster grouping
CREATE INDEX IF NOT EXISTS idx_blog_articles_topic_cluster
  ON public.blog_articles (topic_cluster)
  WHERE topic_cluster IS NOT NULL;

-- Index for content hash duplicate check
CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_articles_content_hash
  ON public.blog_articles (content_hash)
  WHERE content_hash IS NOT NULL;

-- RLS: blog_articles are publicly readable when published
ALTER TABLE public.blog_articles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Published blog articles are publicly readable"
    ON public.blog_articles FOR SELECT
    USING (status = 'published');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;