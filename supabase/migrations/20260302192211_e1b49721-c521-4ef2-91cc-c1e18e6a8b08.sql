
-- ═══════════════════════════════════════════════════════
-- ELITE GOVERNANCE GUARD-PACK: exam_questions
-- Ensures all approved questions have complete SSOT fields
-- ═══════════════════════════════════════════════════════

-- 1) approved requires difficulty
ALTER TABLE public.exam_questions
ADD CONSTRAINT exam_questions_approved_requires_difficulty
CHECK (status <> 'approved' OR difficulty IS NOT NULL);

-- 2) approved requires cognitive_level (Bloom)
ALTER TABLE public.exam_questions
ADD CONSTRAINT exam_questions_approved_requires_bloom
CHECK (status <> 'approved' OR cognitive_level IS NOT NULL);

-- 3) approved requires learning_field_id
ALTER TABLE public.exam_questions
ADD CONSTRAINT exam_questions_approved_requires_lf
CHECK (status <> 'approved' OR learning_field_id IS NOT NULL);

-- 4) approved requires curriculum_id
ALTER TABLE public.exam_questions
ADD CONSTRAINT exam_questions_approved_requires_curriculum
CHECK (status <> 'approved' OR curriculum_id IS NOT NULL);

-- 5) approved requires question_text (non-empty)
ALTER TABLE public.exam_questions
ADD CONSTRAINT exam_questions_approved_requires_text
CHECK (status <> 'approved' OR (question_text IS NOT NULL AND length(question_text) > 10));

-- 6) approved requires correct_answer
ALTER TABLE public.exam_questions
ADD CONSTRAINT exam_questions_approved_requires_answer
CHECK (status <> 'approved' OR correct_answer IS NOT NULL);
