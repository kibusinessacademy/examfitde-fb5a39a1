
-- Pre-built session templates generated from approved oral exam blueprints
-- These are NOT user-specific; they become user sessions at runtime
CREATE TABLE public.oral_exam_session_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES public.course_packages(id),
  curriculum_id UUID NOT NULL,
  blueprint_id UUID NOT NULL REFERENCES public.oral_exam_blueprints(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'practice',
  scenario TEXT NOT NULL,
  lead_questions JSONB NOT NULL DEFAULT '[]',
  followup_questions JSONB NOT NULL DEFAULT '[]',
  rubric JSONB NOT NULL DEFAULT '{}',
  time_limit_minutes INT NOT NULL DEFAULT 20,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  learning_field_id UUID,
  competency_id UUID,
  sort_order INT NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.oral_exam_session_templates ENABLE ROW LEVEL SECURITY;

-- Public read for learners
CREATE POLICY "Anyone can read session templates"
  ON public.oral_exam_session_templates FOR SELECT USING (true);

-- Service role insert/delete
CREATE POLICY "Service role manages templates"
  ON public.oral_exam_session_templates FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_oral_session_templates_package ON public.oral_exam_session_templates(package_id);
CREATE INDEX idx_oral_session_templates_curriculum ON public.oral_exam_session_templates(curriculum_id);
