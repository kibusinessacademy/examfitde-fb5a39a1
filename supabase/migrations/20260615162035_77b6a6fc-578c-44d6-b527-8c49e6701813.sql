
-- Supported languages constraint shared
DO $$ BEGIN
  CREATE TYPE public.supported_language AS ENUM ('de','en','tr','ar','uk','ru');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ course_translations ============
CREATE TABLE IF NOT EXISTS public.course_translations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  language public.supported_language NOT NULL,
  title TEXT,
  description TEXT,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|translating|published|failed|stale
  model TEXT,
  quality_score NUMERIC,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, language)
);
GRANT SELECT ON public.course_translations TO anon, authenticated;
GRANT ALL ON public.course_translations TO service_role;
ALTER TABLE public.course_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read published course translations"
  ON public.course_translations FOR SELECT
  USING (status = 'published');
CREATE POLICY "Admins manage course translations"
  ON public.course_translations FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ lesson_translations ============
CREATE TABLE IF NOT EXISTS public.lesson_translations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  language public.supported_language NOT NULL,
  title TEXT,
  content TEXT,
  summary TEXT,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  quality_score NUMERIC,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, language)
);
GRANT SELECT ON public.lesson_translations TO anon, authenticated;
GRANT ALL ON public.lesson_translations TO service_role;
ALTER TABLE public.lesson_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read published lesson translations"
  ON public.lesson_translations FOR SELECT
  USING (status = 'published');
CREATE POLICY "Admins manage lesson translations"
  ON public.lesson_translations FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ question_translations ============
CREATE TABLE IF NOT EXISTS public.question_translations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  language public.supported_language NOT NULL,
  prompt TEXT,
  options JSONB,
  explanation TEXT,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  quality_score NUMERIC,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, language)
);
GRANT SELECT ON public.question_translations TO anon, authenticated;
GRANT ALL ON public.question_translations TO service_role;
ALTER TABLE public.question_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read published question translations"
  ON public.question_translations FOR SELECT
  USING (status = 'published');
CREATE POLICY "Admins manage question translations"
  ON public.question_translations FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ translation_jobs ============
CREATE TABLE IF NOT EXISTS public.translation_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('course','lesson','question')),
  entity_id UUID NOT NULL,
  language public.supported_language NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|running|done|failed|skipped
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  priority INT NOT NULL DEFAULT 100,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, language)
);
GRANT SELECT ON public.translation_jobs TO authenticated;
GRANT ALL ON public.translation_jobs TO service_role;
ALTER TABLE public.translation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read translation jobs"
  ON public.translation_jobs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage translation jobs"
  ON public.translation_jobs FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- updated_at triggers (reuse existing fn if present)
CREATE OR REPLACE FUNCTION public.tg_translations_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS course_translations_updated ON public.course_translations;
CREATE TRIGGER course_translations_updated BEFORE UPDATE ON public.course_translations
  FOR EACH ROW EXECUTE FUNCTION public.tg_translations_set_updated_at();
DROP TRIGGER IF EXISTS lesson_translations_updated ON public.lesson_translations;
CREATE TRIGGER lesson_translations_updated BEFORE UPDATE ON public.lesson_translations
  FOR EACH ROW EXECUTE FUNCTION public.tg_translations_set_updated_at();
DROP TRIGGER IF EXISTS question_translations_updated ON public.question_translations;
CREATE TRIGGER question_translations_updated BEFORE UPDATE ON public.question_translations
  FOR EACH ROW EXECUTE FUNCTION public.tg_translations_set_updated_at();
DROP TRIGGER IF EXISTS translation_jobs_updated ON public.translation_jobs;
CREATE TRIGGER translation_jobs_updated BEFORE UPDATE ON public.translation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_translations_set_updated_at();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_course_translations_lang_status ON public.course_translations(language, status);
CREATE INDEX IF NOT EXISTS idx_lesson_translations_lang_status ON public.lesson_translations(language, status);
CREATE INDEX IF NOT EXISTS idx_question_translations_lang_status ON public.question_translations(language, status);
CREATE INDEX IF NOT EXISTS idx_translation_jobs_dispatch ON public.translation_jobs(status, scheduled_at, priority);
