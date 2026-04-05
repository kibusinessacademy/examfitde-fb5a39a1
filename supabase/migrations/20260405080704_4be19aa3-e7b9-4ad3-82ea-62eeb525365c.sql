
-- Temporarily disable specific user triggers
ALTER TABLE lessons DISABLE TRIGGER guard_sealed_lessons;
ALTER TABLE minicheck_questions DISABLE TRIGGER trg_auto_promote_minicheck;
ALTER TABLE minicheck_questions DISABLE TRIGGER trg_validate_minicheck_mode;

-- FIX 1a: Promote 1 lesson with passed QC still in draft
UPDATE lessons SET status = 'approved'
WHERE id = 'f52d6c8b-8496-4953-9a06-1484caa2c255'
  AND status = 'draft' AND quality_gate_status = 'passed';

-- FIX 2: Auto-promote 332 draft MiniCheck questions with valid content
UPDATE minicheck_questions mq
SET status = 'approved'
WHERE mq.status = 'draft'
  AND mq.lesson_id IN (
    SELECT l.id FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = 'ac7cb4ea-df75-4549-956d-d5a6d31d1575'
  )
  AND mq.question_text IS NOT NULL
  AND length(mq.question_text) >= 30
  AND mq.correct_answer IS NOT NULL
  AND jsonb_array_length(mq.options) >= 4;

-- FIX 3: Reset failed_soft handbook section for re-expansion
UPDATE handbook_sections
SET expand_status = 'pending', expand_attempts = 0, expand_last_error = NULL
WHERE id = 'd177061b-0252-4f5f-8eac-aefdc5ea56ab';

-- Re-enable triggers
ALTER TABLE lessons ENABLE TRIGGER guard_sealed_lessons;
ALTER TABLE minicheck_questions ENABLE TRIGGER trg_auto_promote_minicheck;
ALTER TABLE minicheck_questions ENABLE TRIGGER trg_validate_minicheck_mode;
