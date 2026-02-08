-- =====================================================
-- FIX 1: exam_questions Answer Exposure
-- Create a safe view that hides correct_answer from students
-- =====================================================

-- Create safe view without sensitive fields (correct_answer, explanation)
CREATE OR REPLACE VIEW public.exam_questions_safe AS
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

-- Grant access to the view for authenticated users
GRANT SELECT ON public.exam_questions_safe TO authenticated;

-- Drop the old permissive policy that exposes answers
DROP POLICY IF EXISTS "Users can view approved questions" ON public.exam_questions;

-- Create new restrictive policy: Only admins can access the raw table with answers
CREATE POLICY "Only admins can view questions with answers"
ON public.exam_questions FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'));

COMMENT ON VIEW public.exam_questions_safe IS 'Safe view of exam questions without correct_answer exposed. Use this for student-facing queries.';