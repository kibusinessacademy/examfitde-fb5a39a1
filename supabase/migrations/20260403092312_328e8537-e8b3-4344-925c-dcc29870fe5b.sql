
-- 1. Add audit columns (idempotent)
ALTER TABLE public.minicheck_questions
ADD COLUMN IF NOT EXISTS approved_by text,
ADD COLUMN IF NOT EXISTS approved_at timestamptz,
ADD COLUMN IF NOT EXISTS approval_reason text;

-- 2. Backfill audit on existing approved
UPDATE public.minicheck_questions
SET approved_by = 'auto_qc_minicheck_v1',
    approved_at = updated_at,
    approval_reason = 'bulk_backfill_v1'
WHERE status = 'approved' AND approved_by IS NULL;

-- 3. Recreate views
DROP VIEW IF EXISTS public.v_minicheck_qc_overview;

CREATE VIEW public.v_minicheck_qc_overview AS
SELECT 
  mq.curriculum_id,
  cu.title as curriculum_title,
  count(*) as total_questions,
  count(*) FILTER (WHERE mq.status = 'approved') as approved,
  count(*) FILTER (WHERE mq.status = 'draft') as still_draft,
  count(*) FILTER (WHERE mq.trap_type IS NOT NULL) as with_trap_type,
  count(*) FILTER (WHERE mq.trap_tags != '{}') as with_trap_tags,
  round(100.0 * count(*) FILTER (WHERE mq.status = 'approved') / NULLIF(count(*), 0), 1) as approval_rate,
  round(100.0 * count(*) FILTER (WHERE mq.trap_type IS NOT NULL) / NULLIF(count(*) FILTER (WHERE mq.status = 'approved'), 0), 1) as trap_coverage_approved,
  count(DISTINCT mq.competency_id) as competencies_covered,
  count(*) FILTER (WHERE mq.approved_by IS NOT NULL) as auto_approved_count,
  (SELECT fn_minicheck_publish_gate(mq.curriculum_id)) as publish_gate
FROM minicheck_questions mq
LEFT JOIN curricula cu ON cu.id = mq.curriculum_id
GROUP BY mq.curriculum_id, cu.title;

CREATE VIEW public.v_minicheck_curriculum_drift AS
SELECT 
  mq.id as question_id,
  mq.curriculum_id as stored_curriculum_id,
  lf.curriculum_id as derived_curriculum_id,
  mq.competency_id,
  c.title as competency_title
FROM minicheck_questions mq
JOIN competencies c ON c.id = mq.competency_id
JOIN learning_fields lf ON lf.id = c.learning_field_id
WHERE mq.curriculum_id IS DISTINCT FROM lf.curriculum_id;

NOTIFY pgrst, 'reload schema';
