-- Blog articles table for SEO content engine
CREATE TABLE public.blog_articles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  meta_description TEXT,
  keywords TEXT[] DEFAULT '{}',
  content_md TEXT NOT NULL,
  source_question_id UUID REFERENCES public.exam_questions(id) ON DELETE SET NULL,
  source_curriculum_id UUID,
  source_package_id UUID,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ DEFAULT now(),
  generated_by_model TEXT DEFAULT 'google/gemini-3-flash-preview',
  word_count INTEGER DEFAULT 0,
  reading_time_min INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_articles_slug ON public.blog_articles(slug);
CREATE INDEX idx_blog_articles_status ON public.blog_articles(status);
CREATE INDEX idx_blog_articles_published_at ON public.blog_articles(published_at DESC);
CREATE INDEX idx_blog_articles_source_question ON public.blog_articles(source_question_id);

ALTER TABLE public.blog_articles ENABLE ROW LEVEL SECURITY;

-- Anyone can read published articles (public SEO pages)
CREATE POLICY "Published blog articles are public"
  ON public.blog_articles FOR SELECT
  USING (status = 'published');

-- Video scripts table for social media content engine
CREATE TABLE public.video_scripts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  format_type TEXT NOT NULL DEFAULT 'mini_klausur',
  hook_text TEXT NOT NULL,
  body_text TEXT NOT NULL,
  twist_text TEXT,
  cta_text TEXT NOT NULL DEFAULT 'Teste dich kostenlos auf ExamFit.',
  caption_text TEXT,
  script_json JSONB DEFAULT '{}',
  source_question_id UUID REFERENCES public.exam_questions(id) ON DELETE SET NULL,
  source_curriculum_id UUID,
  source_package_id UUID,
  status TEXT NOT NULL DEFAULT 'ready',
  generated_by_model TEXT DEFAULT 'google/gemini-3-flash-preview',
  render_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_scripts_status ON public.video_scripts(status);
CREATE INDEX idx_video_scripts_format ON public.video_scripts(format_type);
CREATE INDEX idx_video_scripts_source_question ON public.video_scripts(source_question_id);

ALTER TABLE public.video_scripts ENABLE ROW LEVEL SECURITY;

-- Only admins can view video scripts
CREATE POLICY "Admins can view video scripts"
  ON public.video_scripts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Timestamp trigger for both tables
CREATE TRIGGER update_blog_articles_updated_at
  BEFORE UPDATE ON public.blog_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_video_scripts_updated_at
  BEFORE UPDATE ON public.video_scripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();