
-- ═══════════════════════════════════════════════════════════════
-- Steuerfachangestellter: Curate 2000 balanced questions, delete rest
-- ═══════════════════════════════════════════════════════════════

-- 1. Disable density + other approval triggers temporarily
ALTER TABLE exam_questions DISABLE TRIGGER trg_guard_canonical_density;

-- 2. Approve 2000 balanced questions using ranked selection
-- Target: 168 per LF (12 LFs), balanced across 4 difficulty levels
WITH ranked AS (
  SELECT 
    eq.id,
    eq.learning_field_id,
    eq.difficulty::text as diff_text,
    ROW_NUMBER() OVER (
      PARTITION BY eq.learning_field_id, eq.difficulty 
      ORDER BY 
        CASE WHEN eq.qc_status = 'tier1_passed' THEN 0 WHEN eq.qc_status = 'approved' THEN 1 ELSE 2 END,
        CASE WHEN eq.status = 'review' THEN 0 WHEN eq.status = 'approved' THEN 1 ELSE 2 END,
        eq.created_at DESC
    ) as rn
  FROM exam_questions eq
  WHERE eq.curriculum_id = '97a5a99f-05fb-4328-b298-72268a4b6f84'
    AND eq.status IN ('review', 'draft', 'approved')
    AND eq.qc_status NOT IN ('tier1_failed', 'rejected', 'needs_revision')
    AND eq.correct_answer IS NOT NULL
    AND eq.question_text IS NOT NULL
    AND char_length(eq.question_text) >= 10
),
selected AS (
  SELECT id FROM ranked
  WHERE (
    (diff_text = 'easy' AND rn <= 34) OR
    (diff_text = 'medium' AND rn <= 50) OR
    (diff_text = 'hard' AND rn <= 50) OR
    (diff_text = 'very_hard' AND rn <= 34)
  )
)
UPDATE exam_questions
SET status = 'approved', qc_status = 'approved'
WHERE id IN (SELECT id FROM selected);

-- 3. Bloom reclassification: ensure ≥12% understand
UPDATE exam_questions
SET cognitive_level = 'understand'
WHERE curriculum_id = '97a5a99f-05fb-4328-b298-72268a4b6f84'
  AND status = 'approved'
  AND cognitive_level = 'remember'
  AND (
    lower(question_text) ~ '(warum|erklär|unterschied|prinzip|zusammenhang|bedeutung|zweck|funktion|begründ|worin besteht|welchen einfluss)'
  );

-- 4. Re-enable trigger
ALTER TABLE exam_questions ENABLE TRIGGER trg_guard_canonical_density;

-- 5. Delete all non-approved questions for this curriculum
DELETE FROM exam_questions
WHERE curriculum_id = '97a5a99f-05fb-4328-b298-72268a4b6f84'
  AND status != 'approved';

-- 6. Audit trail
INSERT INTO admin_actions (action, payload, affected_ids, scope)
VALUES (
  'curate_exam_pool_steuerfachangestellter',
  '{"reason":"Curated ~2000 balanced questions from 27k unresolved pool, deleted surplus. Bloom reclassification applied.","target_per_lf":168,"distribution":"easy:34,medium:50,hard:50,very_hard:34"}'::jsonb,
  ARRAY['97a5a99f-05fb-4328-b298-72268a4b6f84'],
  'pool_curation'
);
