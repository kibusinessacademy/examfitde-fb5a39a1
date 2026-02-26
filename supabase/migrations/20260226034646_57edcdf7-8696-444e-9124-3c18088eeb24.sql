
-- Grant execute to the roles that need it
GRANT EXECUTE ON FUNCTION public.promote_exam_questions_from_council(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_exam_questions_from_council(UUID, INT) TO authenticated;
