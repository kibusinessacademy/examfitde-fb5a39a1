
-- Hard-Guard: approved exam questions MUST have competency_id
ALTER TABLE public.exam_questions
ADD CONSTRAINT exam_questions_approved_requires_competency
CHECK (status <> 'approved' OR competency_id IS NOT NULL);
