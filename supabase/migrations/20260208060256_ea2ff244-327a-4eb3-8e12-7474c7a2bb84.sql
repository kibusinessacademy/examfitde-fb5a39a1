-- Fix the SECURITY DEFINER view issue by explicitly setting SECURITY INVOKER
-- This ensures RLS policies of the querying user are applied

DROP VIEW IF EXISTS public.exam_questions_safe;

CREATE VIEW public.exam_questions_safe
WITH (security_invoker = true)
AS
SELECT 
  id,
  curriculum_id,
  learning_field_id,
  competency_id,
  question_text,
  options,
  difficulty,
  status,
  ai_generated,
  created_at
FROM public.exam_questions
WHERE status = 'approved';

-- Re-grant access
GRANT SELECT ON public.exam_questions_safe TO authenticated;

COMMENT ON VIEW public.exam_questions_safe IS 'Safe view of exam questions without correct_answer. Uses SECURITY INVOKER for proper RLS.';