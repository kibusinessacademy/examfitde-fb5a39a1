
-- ═══════════════════════════════════════════════════════════
-- QW #11: Auto-Reannotate RPC for stale/missing annotations
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reannotate_stale_questions(
  p_curriculum_id uuid DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE(question_id uuid, reason text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Returns question IDs that need (re)annotation:
  -- 1. Questions with no annotation at all
  -- 2. Questions where annotation is older than question (stale)
  SELECT eq.id AS question_id, 
         CASE WHEN ann.question_id IS NULL THEN 'missing' ELSE 'stale' END AS reason
  FROM exam_questions eq
  LEFT JOIN exam_question_elite_annotations ann ON ann.question_id = eq.id
  WHERE eq.status = 'approved'
    AND (p_curriculum_id IS NULL OR eq.curriculum_id = p_curriculum_id)
    AND (
      ann.question_id IS NULL  -- missing
      OR ann.annotated_at < eq.created_at  -- stale (created_at as proxy for updated_at)
    )
  ORDER BY eq.created_at DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.reannotate_stale_questions(uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reannotate_stale_questions(uuid, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reannotate_stale_questions(uuid, int) FROM authenticated;

-- ═══════════════════════════════════════════════════════════
-- QW #14: MiniCheck Publishing Quality Gate
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.validate_minicheck_quality(
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_min_total int DEFAULT 6,
  p_min_elite int DEFAULT 4,
  p_min_avg_score numeric DEFAULT 8.0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_elite int;
  v_advanced int;
  v_avg_score numeric;
  v_all_typed boolean;
  v_issues text[] := '{}';
  v_pass boolean := true;
BEGIN
  -- Count available annotated questions for this competency
  SELECT 
    count(*),
    count(*) FILTER (WHERE ann.elite_level = 'elite'),
    count(*) FILTER (WHERE ann.elite_level = 'advanced'),
    coalesce(avg(ann.score), 0),
    bool_and(ann.distractor_types IS NOT NULL AND ann.distractor_types != '{}')
  INTO v_total, v_elite, v_advanced, v_avg_score, v_all_typed
  FROM exam_questions eq
  JOIN exam_question_elite_annotations ann ON ann.question_id = eq.id
  WHERE eq.curriculum_id = p_curriculum_id
    AND eq.competency_id = p_competency_id
    AND eq.status = 'approved';

  IF v_total < p_min_total THEN
    v_pass := false;
    v_issues := array_append(v_issues, format('too_few_questions: %s < %s', v_total, p_min_total));
  END IF;

  IF v_elite < p_min_elite THEN
    v_pass := false;
    v_issues := array_append(v_issues, format('too_few_elite: %s < %s', v_elite, p_min_elite));
  END IF;

  IF v_avg_score < p_min_avg_score THEN
    v_pass := false;
    v_issues := array_append(v_issues, format('avg_score_low: %s < %s', round(v_avg_score, 2), p_min_avg_score));
  END IF;

  IF NOT coalesce(v_all_typed, false) THEN
    v_issues := array_append(v_issues, 'not_all_distractor_typed');
    -- Warning, not blocking
  END IF;

  RETURN jsonb_build_object(
    'pass', v_pass,
    'total', v_total,
    'elite', v_elite,
    'advanced', v_advanced,
    'avg_score', round(v_avg_score, 2),
    'all_distractor_typed', coalesce(v_all_typed, false),
    'issues', to_jsonb(v_issues)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_minicheck_quality(uuid, uuid, int, int, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_minicheck_quality(uuid, uuid, int, int, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_minicheck_quality(uuid, uuid, int, int, numeric) FROM authenticated;

-- ═══════════════════════════════════════════════════════════
-- QW #15: Add last_exported_at to course_package_outputs for delta export
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.course_package_outputs 
  ADD COLUMN IF NOT EXISTS last_exported_at timestamptz,
  ADD COLUMN IF NOT EXISTS export_checksum text;
