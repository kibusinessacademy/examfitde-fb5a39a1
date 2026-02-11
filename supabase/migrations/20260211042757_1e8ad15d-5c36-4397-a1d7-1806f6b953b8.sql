
-- ============================================================
-- EXAMFIT 7-GATE QUALITY SYSTEM – Schema Extension
-- ============================================================

-- 1. Lessons: neue Spalten für Quality Gates
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS exam_relevance_score smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mastery_weight numeric(3,2) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS quality_gate_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS quality_flags jsonb DEFAULT '[]'::jsonb;

-- 2. Courses: Quality Score + Publishing State Machine
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS quality_score smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_report jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publishing_status text DEFAULT 'draft';

-- 3. Quality Gate Results – pro Gate pro Kurs
CREATE TABLE IF NOT EXISTS public.quality_gate_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  gate_number smallint NOT NULL,
  gate_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- passed, failed, warning
  score smallint DEFAULT 0,
  issues jsonb DEFAULT '[]'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_qgr_course ON public.quality_gate_results(course_id);
CREATE INDEX IF NOT EXISTS idx_qgr_gate ON public.quality_gate_results(course_id, gate_number);

ALTER TABLE public.quality_gate_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage quality gate results"
  ON public.quality_gate_results FOR ALL
  USING (true) WITH CHECK (true);

-- 4. Disallowed Keywords – pro Curriculum für Fachfremd-Check
CREATE TABLE IF NOT EXISTS public.disallowed_keywords (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  category text DEFAULT 'foreign_content',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dk_curriculum ON public.disallowed_keywords(curriculum_id);

ALTER TABLE public.disallowed_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage disallowed keywords"
  ON public.disallowed_keywords FOR ALL
  USING (true) WITH CHECK (true);

-- 5. Content Hash Index für Duplikat-Erkennung
CREATE INDEX IF NOT EXISTS idx_lessons_content_hash ON public.lessons(content_hash)
  WHERE content_hash IS NOT NULL;

-- 6. Composite Index für Gate-Status-Abfragen
CREATE INDEX IF NOT EXISTS idx_lessons_quality_gate ON public.lessons(quality_gate_status);

-- 7. Publishing Status Index
CREATE INDEX IF NOT EXISTS idx_courses_publishing ON public.courses(publishing_status);
