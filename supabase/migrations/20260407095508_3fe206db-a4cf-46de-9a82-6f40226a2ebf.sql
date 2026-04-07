-- 1. Add topic_fingerprint for intent-based dedup
ALTER TABLE public.blog_articles
  ADD COLUMN IF NOT EXISTS topic_fingerprint text;

-- 2. Unique guard: same curriculum + topic intent + article type = duplicate
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_topic_intent
  ON public.blog_articles (source_curriculum_id, topic_fingerprint, article_type)
  WHERE status NOT IN ('failed_validation', 'failed_ai_detection', 'duplicate');

-- 3. Publishing events table (SSOT publish audit trail)
CREATE TABLE IF NOT EXISTS public.blog_publishing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid REFERENCES public.blog_articles(id) ON DELETE CASCADE NOT NULL,
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}',
  triggered_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.blog_publishing_events ENABLE ROW LEVEL SECURITY;

-- Only service role can insert (edge functions)
CREATE POLICY "Service role only"
  ON public.blog_publishing_events
  FOR ALL
  USING (false);

CREATE INDEX idx_blog_pub_events_article ON public.blog_publishing_events(article_id);
CREATE INDEX idx_blog_pub_events_type ON public.blog_publishing_events(event_type);