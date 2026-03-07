
-- 1) Simple RPC to list curricula titles (SSOT-compliant, no direct .from() needed)
CREATE OR REPLACE FUNCTION public.list_b2b_curricula()
RETURNS TABLE(id uuid, title text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.title
  FROM curricula c
  ORDER BY c.title;
$$;

-- 2) Add membership guard to get_org_competency_dashboard
-- Drop and recreate with auth check
CREATE OR REPLACE FUNCTION public.get_org_competency_dashboard(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_curricula jsonb;
  v_total_learners int := 0;
  v_overall_readiness numeric := 0;
  v_total_at_risk int := 0;
  v_total_exam_ready int := 0;
  v_curriculum_count int := 0;
  v_calling_user uuid;
BEGIN
  -- Auth: caller must be org member or admin
  v_calling_user := auth.uid();
  IF v_calling_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check membership (skip for admins)
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_organization_id AND user_id = v_calling_user
  ) AND NOT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = v_calling_user AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organization';
  END IF;

  -- Get distinct curricula for this org's active seats
  WITH org_curricula AS (
    SELECT DISTINCT os.certification_id AS curriculum_id
    FROM organization_seats os
    WHERE os.organization_id = p_organization_id
      AND os.seat_status = 'active'
      AND os.certification_id IS NOT NULL
  ),
  per_curriculum AS (
    SELECT
      oc.curriculum_id,
      c.title,
      COUNT(DISTINCT os.learner_user_id) AS learner_count,
      COALESCE(AVG(uss.decay_adjusted_mastery * 100), 0) AS avg_readiness_pct,
      COUNT(DISTINCT CASE WHEN uss.mastery_status = 'not_mastered' THEN os.learner_user_id END) AS at_risk_count,
      COUNT(DISTINCT CASE WHEN uss.mastery_status = 'mastered' THEN os.learner_user_id END) AS exam_ready_count
    FROM org_curricula oc
    JOIN curricula c ON c.id = oc.curriculum_id
    JOIN organization_seats os ON os.certification_id = oc.curriculum_id
      AND os.organization_id = p_organization_id
      AND os.seat_status = 'active'
    LEFT JOIN curriculum_skills cs ON cs.curriculum_id = oc.curriculum_id
    LEFT JOIN user_skill_scores uss ON uss.skill_id = cs.skill_id
      AND uss.user_id = os.learner_user_id
    GROUP BY oc.curriculum_id, c.title
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'curriculum_id', pc.curriculum_id,
        'title', pc.title,
        'learner_count', pc.learner_count,
        'avg_readiness_pct', ROUND(pc.avg_readiness_pct, 1),
        'at_risk_count', pc.at_risk_count,
        'exam_ready_count', pc.exam_ready_count
      ) ORDER BY pc.avg_readiness_pct ASC
    ), '[]'::jsonb),
    COALESCE(SUM(pc.learner_count), 0),
    CASE WHEN COUNT(*) > 0 THEN ROUND(AVG(pc.avg_readiness_pct), 1) ELSE 0 END,
    COALESCE(SUM(pc.at_risk_count), 0),
    COALESCE(SUM(pc.exam_ready_count), 0),
    COUNT(*)
  INTO v_curricula, v_total_learners, v_overall_readiness, v_total_at_risk, v_total_exam_ready, v_curriculum_count
  FROM per_curriculum pc;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'total_learners', v_total_learners,
    'overall_readiness_pct', v_overall_readiness,
    'total_at_risk', v_total_at_risk,
    'total_exam_ready', v_total_exam_ready,
    'curriculum_count', v_curriculum_count,
    'curricula', v_curricula
  );
END;
$$;
