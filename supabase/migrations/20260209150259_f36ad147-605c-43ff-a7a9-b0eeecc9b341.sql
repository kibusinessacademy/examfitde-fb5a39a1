
-- 1. Per-lesson audit results (granular tracking)
CREATE TABLE public.lesson_quality_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL,
  course_audit_id UUID REFERENCES public.course_quality_audits(id) ON DELETE CASCADE,
  audit_score INTEGER NOT NULL DEFAULT 0,
  dimension_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_rules TEXT[] NOT NULL DEFAULT '{}',
  verbesserungspotenzial JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. AI improvement suggestions per lesson
CREATE TABLE public.lesson_improvement_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL,
  rule TEXT NOT NULL,
  suggested_change JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Lesson revision history (old vs new content diff)
CREATE TABLE public.lesson_revisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL,
  old_content JSONB,
  new_content JSONB,
  reason TEXT NOT NULL DEFAULT 'auto_improvement',
  improvements_applied TEXT[] NOT NULL DEFAULT '{}',
  score_before INTEGER,
  score_after INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX idx_lesson_quality_audits_lesson ON public.lesson_quality_audits(lesson_id);
CREATE INDEX idx_lesson_quality_audits_course ON public.lesson_quality_audits(course_audit_id);
CREATE INDEX idx_lesson_improvement_suggestions_lesson ON public.lesson_improvement_suggestions(lesson_id);
CREATE INDEX idx_lesson_revisions_lesson ON public.lesson_revisions(lesson_id);

-- RLS enabled (admin-only access via service role)
ALTER TABLE public.lesson_quality_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_improvement_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_revisions ENABLE ROW LEVEL SECURITY;

-- Admin read policies
CREATE POLICY "Admins can read lesson audits" ON public.lesson_quality_audits
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can read improvement suggestions" ON public.lesson_improvement_suggestions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can read lesson revisions" ON public.lesson_revisions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
