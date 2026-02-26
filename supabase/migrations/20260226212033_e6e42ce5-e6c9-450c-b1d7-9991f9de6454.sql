-- ══════════════════════════════════════════════════════════════
-- QW #3: Coverage Dashboard View (per LF + competency)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.curriculum_elite_coverage_v AS
WITH q_base AS (
  SELECT
    eq.curriculum_id,
    eq.learning_field_id,
    eq.competency_id,
    eq.id AS question_id,
    eq.status,
    a.elite_level AS ann_elite_level,
    a.elite_score AS ann_score,
    a.multi_variable AS ann_multi_variable,
    a.transfer_variant AS ann_transfer_variant,
    a.distractor_types AS ann_distractor_types,
    a.annotated_at
  FROM exam_questions eq
  LEFT JOIN exam_question_elite_annotations a ON a.question_id = eq.id
  WHERE eq.status IN ('approved', 'draft')
),
by_comp AS (
  SELECT
    curriculum_id,
    learning_field_id,
    competency_id,
    count(*) AS q_total,
    count(*) FILTER (WHERE status = 'approved') AS q_approved,
    count(annotated_at) AS q_annotated,
    count(*) FILTER (WHERE ann_elite_level = 'elite') AS elite_cnt,
    count(*) FILTER (WHERE ann_elite_level = 'advanced') AS advanced_cnt,
    round(avg(ann_score)::numeric, 2) AS avg_score,
    count(*) FILTER (WHERE ann_multi_variable = true) AS multi_variable_cnt,
    count(*) FILTER (WHERE ann_transfer_variant = true) AS transfer_cnt
  FROM q_base
  GROUP BY curriculum_id, learning_field_id, competency_id
)
SELECT
  curriculum_id,
  learning_field_id,
  competency_id,
  q_total,
  q_approved,
  q_annotated,
  CASE WHEN q_total > 0 THEN round(100.0 * q_annotated / q_total, 1) ELSE 0 END AS pct_annotated,
  elite_cnt,
  advanced_cnt,
  avg_score,
  multi_variable_cnt,
  transfer_cnt,
  CASE WHEN q_total > 0 THEN round(100.0 * elite_cnt / q_total, 1) ELSE 0 END AS pct_elite
FROM by_comp;

-- Global summary per curriculum
CREATE OR REPLACE VIEW public.curriculum_elite_summary_v AS
SELECT
  curriculum_id,
  sum(q_total)::int AS q_total,
  sum(q_approved)::int AS q_approved,
  sum(q_annotated)::int AS q_annotated,
  CASE WHEN sum(q_total) > 0 THEN round(100.0 * sum(q_annotated) / sum(q_total), 1) ELSE 0 END AS pct_annotated,
  sum(elite_cnt)::int AS elite_cnt,
  sum(advanced_cnt)::int AS advanced_cnt,
  round(avg(avg_score)::numeric, 2) AS avg_score,
  sum(multi_variable_cnt)::int AS multi_variable_cnt,
  sum(transfer_cnt)::int AS transfer_cnt,
  CASE WHEN sum(q_total) > 0 THEN round(100.0 * sum(elite_cnt) / sum(q_total), 1) ELSE 0 END AS pct_elite,
  count(DISTINCT competency_id)::int AS competencies_with_questions
FROM curriculum_elite_coverage_v
GROUP BY curriculum_id;

-- ══════════════════════════════════════════════════════════════
-- QW #4: Annotation Freshness (stale detection via created_at)
-- exam_questions has no updated_at, use created_at as proxy
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.stale_elite_annotations_v AS
SELECT
  eq.id AS question_id,
  eq.curriculum_id,
  eq.created_at AS question_created_at,
  a.annotated_at,
  CASE
    WHEN a.annotated_at IS NULL THEN 'missing'
    WHEN eq.created_at > a.annotated_at THEN 'stale'
    ELSE 'fresh'
  END AS freshness
FROM exam_questions eq
LEFT JOIN exam_question_elite_annotations a ON a.question_id = eq.id
WHERE eq.status IN ('approved', 'draft');

-- ══════════════════════════════════════════════════════════════
-- QW #5: Run Lease/Lock (double-run protection)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.elite_hardening_runs
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

-- RPC: Acquire lease (returns run_id if acquired, null if locked)
CREATE OR REPLACE FUNCTION public.acquire_elite_harden_lease(
  p_package_id uuid,
  p_phase text,
  p_locked_by text DEFAULT 'edge_function',
  p_lease_seconds int DEFAULT 180
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  -- Check for active lease
  SELECT id INTO v_run_id
  FROM elite_hardening_runs
  WHERE package_id = p_package_id
    AND phase = p_phase
    AND status = 'running'
    AND lease_expires_at > now()
  LIMIT 1;

  IF v_run_id IS NOT NULL THEN
    RETURN NULL; -- already locked
  END IF;

  -- Try to claim: update any running run with expired/no lease
  UPDATE elite_hardening_runs
  SET locked_by = p_locked_by,
      locked_at = now(),
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval
  WHERE id = (
    SELECT id FROM elite_hardening_runs
    WHERE package_id = p_package_id
      AND phase = p_phase
      AND status = 'running'
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END $$;

-- Lock down RPCs to service_role only
REVOKE EXECUTE ON FUNCTION public.acquire_elite_harden_lease FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_elite_harden_lease TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_exam_question_meta_if_draft FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_exam_question_meta_if_draft TO service_role;