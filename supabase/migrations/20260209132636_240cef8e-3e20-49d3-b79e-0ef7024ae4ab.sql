
-- Table to store IHK-Prüfer quality audit results
CREATE TABLE public.course_quality_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id),
  audit_type TEXT NOT NULL DEFAULT 'ihk_pruefer',
  overall_score NUMERIC NOT NULL DEFAULT 0,
  overall_grade TEXT NOT NULL DEFAULT 'nicht bestanden',
  dimensions JSONB NOT NULL DEFAULT '{}',
  recommendations JSONB NOT NULL DEFAULT '[]',
  critical_issues JSONB NOT NULL DEFAULT '[]',
  lesson_audits JSONB NOT NULL DEFAULT '[]',
  audited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  audited_by TEXT NOT NULL DEFAULT 'ai-ihk-pruefer',
  model_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookup
CREATE INDEX idx_course_quality_audits_course ON public.course_quality_audits(course_id);
CREATE INDEX idx_course_quality_audits_date ON public.course_quality_audits(audited_at DESC);

-- Enable RLS
ALTER TABLE public.course_quality_audits ENABLE ROW LEVEL SECURITY;

-- Admin-only read (service role bypasses RLS, anon can read for admin UI)
CREATE POLICY "Allow read for all" ON public.course_quality_audits FOR SELECT USING (true);

COMMENT ON TABLE public.course_quality_audits IS 'Stores AI-powered IHK examiner quality audits for courses';
