-- Fix: Bind missing triggers that exist as functions but weren't attached

-- 1) guard_publish_requires_real_content → course_packages
DROP TRIGGER IF EXISTS guard_publish_requires_real_content ON public.course_packages;
CREATE TRIGGER guard_publish_requires_real_content
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_publish_requires_real_content();

-- 2) trg_exam_questions_enforce_learning_field_id → exam_questions
DROP TRIGGER IF EXISTS trg_exam_questions_enforce_learning_field_id ON public.exam_questions;
CREATE TRIGGER trg_exam_questions_enforce_learning_field_id
  BEFORE INSERT OR UPDATE ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_exam_questions_enforce_learning_field_id();