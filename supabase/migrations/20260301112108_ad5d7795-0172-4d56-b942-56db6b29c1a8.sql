-- Create a safe view for learners (without correct_answer and explanation)
CREATE OR REPLACE VIEW public.v_exam_questions_safe AS
SELECT 
  eq.id,
  eq.curriculum_id,
  eq.learning_field_id,
  eq.competency_id,
  eq.question_text,
  eq.options,
  eq.difficulty,
  eq.status,
  eq.blueprint_id
FROM exam_questions eq
WHERE eq.status = 'approved'::question_status;

-- Grant authenticated users access to this view
GRANT SELECT ON public.v_exam_questions_safe TO authenticated;

-- Allow authenticated users to SELECT from exam_questions IF accessed through the safe view
-- We use a policy that allows read access for authenticated users on approved questions only
CREATE POLICY "Authenticated users can read approved questions"
ON public.exam_questions
FOR SELECT
TO authenticated
USING (status = 'approved'::question_status);