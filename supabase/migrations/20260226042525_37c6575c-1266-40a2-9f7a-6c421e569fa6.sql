
-- Fix: Create sanitized questions view with correct columns

CREATE OR REPLACE VIEW public.v_exam_questions_sanitized
WITH (security_invoker = on)
AS
SELECT
  id,
  curriculum_id,
  learning_field_id,
  competency_id,
  question_text,
  options,
  difficulty,
  cognitive_level,
  exam_part,
  question_type,
  status
FROM public.exam_questions
WHERE status = 'approved';

-- Revoke direct anon access on critical tables
REVOKE ALL ON public.exam_questions FROM anon;
REVOKE ALL ON public.content_versions FROM anon;
REVOKE ALL ON public.question_attempts FROM anon;
