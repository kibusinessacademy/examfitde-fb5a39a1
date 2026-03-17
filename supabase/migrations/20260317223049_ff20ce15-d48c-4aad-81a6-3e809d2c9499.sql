
-- Memory-safe aggregate RPC for QC status counts
CREATE OR REPLACE FUNCTION count_exam_qc_status(p_curriculum_id uuid)
RETURNS TABLE(qc_status text, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    COALESCE(eq.qc_status, 'null') AS qc_status,
    COUNT(*) AS cnt
  FROM exam_questions eq
  WHERE eq.curriculum_id = p_curriculum_id
  GROUP BY eq.qc_status;
$$;

-- Auto-promotion function: moves promotable drafts to review
CREATE OR REPLACE FUNCTION ops_auto_promote_stale_drafts(p_max_per_run int DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promoted int := 0;
  details jsonb := '[]'::jsonb;
  r RECORD;
BEGIN
  FOR r IN
    SELECT curriculum_id, curriculum_title, promotable_drafts
    FROM v_ops_qc_backlog
    WHERE backlog_health = 'STALE_DRAFTS'
      AND promotable_drafts > 1000
    ORDER BY promotable_drafts DESC
    LIMIT 5
  LOOP
    WITH updated AS (
      UPDATE exam_questions
      SET status = 'review'
      WHERE curriculum_id = r.curriculum_id
        AND status = 'draft'
        AND qc_status = 'pending'
        AND question_text IS NOT NULL
        AND options IS NOT NULL
        AND correct_answer IS NOT NULL
        AND competency_id IS NOT NULL
        AND difficulty IS NOT NULL
        AND cognitive_level IS NOT NULL
        AND length(question_text) >= 10
      RETURNING id
    )
    SELECT COUNT(*) INTO promoted FROM updated;
    
    details := details || jsonb_build_object(
      'curriculum', r.curriculum_title,
      'promoted', promoted
    );
  END LOOP;

  RETURN jsonb_build_object('promoted_total', promoted, 'details', details);
END;
$$;
