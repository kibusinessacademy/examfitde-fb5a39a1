
-- =====================================================
-- Course Generation Pipeline – SSOT + QC + Export Fix
-- =====================================================

-- 1) modules: add learning_field_code for export + clarity
ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS learning_field_code text;

-- 2) lessons: add status + qc_status for pipeline governance
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS qc_status text;

-- 3) minicheck_questions: persist generated questions for QC/exports/analytics
CREATE TABLE IF NOT EXISTS public.minicheck_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  options jsonb NOT NULL,
  correct_answer integer NOT NULL,
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS minicheck_questions_lesson_id_idx
  ON public.minicheck_questions(lesson_id);

-- RLS: admin only (MiniChecks are part of paid IP; keep tight)
ALTER TABLE public.minicheck_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage minicheck_questions"
  ON public.minicheck_questions
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) Learners can read minicheck_questions for their enrolled lessons
CREATE POLICY "Learners read minicheck_questions"
  ON public.minicheck_questions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lessons l
      JOIN public.modules m ON m.id = l.module_id
      JOIN public.course_enrollments ce ON ce.course_id = m.course_id
      WHERE l.id = minicheck_questions.lesson_id
        AND ce.user_id = auth.uid()
    )
  );

-- 5) Helper view for export/QC convenience
CREATE OR REPLACE VIEW public.lesson_qc_view AS
SELECT
  l.id,
  l.module_id,
  l.competency_id,
  l.title,
  l.step,
  l.sort_order,
  l.status,
  l.qc_status,
  l.duration_minutes,
  l.created_at,
  COALESCE(l.content->>'html', '') AS qc_html,
  COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(l.content->'objectives','[]'::jsonb)) AS t(value)
    ),
    ARRAY[]::text[]
  ) AS qc_objectives,
  NULLIF(l.content->>'exam_block','') AS qc_exam_block,
  NULLIF(l.content->>'weight_tag','') AS qc_weight_tag,
  (SELECT count(*) FROM public.minicheck_questions mq WHERE mq.lesson_id = l.id) AS minicheck_count
FROM public.lessons l;
