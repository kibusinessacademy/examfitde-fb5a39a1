
-- ═══ B2B Backend RPCs: Learner, Cohort, Org competency views ═══

-- 1) Single learner profile: mastery, readiness, fail-risk, weak skills, coaching status
CREATE OR REPLACE FUNCTION public.get_learner_competency_profile(
  p_learner_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skills jsonb;
  v_avg_mastery numeric := 0;
  v_avg_confidence numeric := 0;
  v_mastered int := 0;
  v_partial int := 0;
  v_not_mastered int := 0;
  v_total_skills int := 0;
  v_weakest jsonb;
  v_strongest jsonb;
  v_recent_sessions jsonb;
  v_fail_risk numeric;
  v_verdict text;
BEGIN
  -- Skill mastery summary
  SELECT
    count(*),
    coalesce(avg(coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0)), 0),
    coalesce(avg(coalesce(uss.confidence, 0)), 0),
    count(*) FILTER (WHERE uss.mastery_status = 'mastered'),
    count(*) FILTER (WHERE uss.mastery_status = 'partial'),
    count(*) FILTER (WHERE uss.mastery_status = 'not_mastered' OR uss.mastery_status IS NULL)
  INTO v_total_skills, v_avg_mastery, v_avg_confidence, v_mastered, v_partial, v_not_mastered
  FROM public.skill_nodes sn
  LEFT JOIN public.user_skill_scores uss ON uss.skill_node_id = sn.id AND uss.user_id = p_learner_id
  WHERE sn.curriculum_id = p_curriculum_id;

  -- Fail risk
  v_fail_risk := LEAST(100, round((100 - v_avg_mastery) * (1 + (1 - v_avg_confidence) * 0.3), 1));
  v_verdict := CASE
    WHEN v_avg_mastery >= 80 THEN 'exam_ready'
    WHEN v_avg_mastery >= 60 THEN 'almost_ready'
    WHEN v_avg_mastery >= 40 THEN 'needs_work'
    ELSE 'not_ready'
  END;

  -- Weakest 5
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.mastery_pct), '[]'::jsonb)
  INTO v_weakest
  FROM (
    SELECT sn.id as skill_node_id, sn.lernfeld, sn.kompetenz,
      coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0) as mastery_pct,
      coalesce(uss.confidence, 0) as confidence,
      coalesce(uss.mastery_status, 'not_mastered') as mastery_status,
      coalesce(uss.trend, 'stable') as trend
    FROM public.skill_nodes sn
    LEFT JOIN public.user_skill_scores uss ON uss.skill_node_id = sn.id AND uss.user_id = p_learner_id
    WHERE sn.curriculum_id = p_curriculum_id
    ORDER BY coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0) ASC
    LIMIT 5
  ) t;

  -- Strongest 5
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.mastery_pct DESC), '[]'::jsonb)
  INTO v_strongest
  FROM (
    SELECT sn.id as skill_node_id, sn.kompetenz,
      coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0) as mastery_pct
    FROM public.skill_nodes sn
    LEFT JOIN public.user_skill_scores uss ON uss.skill_node_id = sn.id AND uss.user_id = p_learner_id
    WHERE sn.curriculum_id = p_curriculum_id
      AND coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0) >= 80
    ORDER BY coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0) DESC
    LIMIT 5
  ) t;

  -- Recent 5 exam sessions
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.finished_at DESC), '[]'::jsonb)
  INTO v_recent_sessions
  FROM (
    SELECT es.id, es.score_percentage, es.passed, es.mode, es.finished_at, es.total_questions
    FROM public.exam_sessions es
    WHERE es.user_id = p_learner_id AND es.curriculum_id = p_curriculum_id AND es.finished_at IS NOT NULL
    ORDER BY es.finished_at DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'learner_id', p_learner_id,
    'curriculum_id', p_curriculum_id,
    'readiness_pct', round(v_avg_mastery, 1),
    'confidence', round(v_avg_confidence, 2),
    'fail_risk_pct', v_fail_risk,
    'verdict', v_verdict,
    'total_skills', v_total_skills,
    'mastered_count', v_mastered,
    'partial_count', v_partial,
    'not_mastered_count', v_not_mastered,
    'weakest_skills', v_weakest,
    'strongest_skills', v_strongest,
    'recent_sessions', v_recent_sessions
  );
END;
$$;

-- 2) Cohort/course overview: aggregated across all learners in a curriculum
CREATE OR REPLACE FUNCTION public.get_cohort_competency_overview(
  p_curriculum_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_learners jsonb;
  v_total_learners int;
  v_avg_readiness numeric;
  v_at_risk_count int;
  v_exam_ready_count int;
  v_weakest_skills jsonb;
BEGIN
  -- Build per-learner summary
  WITH learner_ids AS (
    SELECT DISTINCT os.learner_user_id as user_id
    FROM public.organization_seats os
    JOIN public.curricula cur ON cur.id = p_curriculum_id
    WHERE os.seat_status = 'active'
      AND (p_organization_id IS NULL OR os.organization_id = p_organization_id)
      AND (os.certification_id = cur.certification_id OR os.certification_id IS NULL)
  ),
  learner_mastery AS (
    SELECT
      li.user_id,
      coalesce(avg(coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0)), 0) as avg_mastery,
      coalesce(avg(coalesce(uss.confidence, 0)), 0) as avg_confidence,
      count(*) FILTER (WHERE uss.mastery_status = 'mastered') as mastered,
      count(*) FILTER (WHERE uss.mastery_status = 'not_mastered' OR uss.mastery_status IS NULL) as not_mastered
    FROM learner_ids li
    CROSS JOIN public.skill_nodes sn
    LEFT JOIN public.user_skill_scores uss ON uss.skill_node_id = sn.id AND uss.user_id = li.user_id
    WHERE sn.curriculum_id = p_curriculum_id
    GROUP BY li.user_id
  )
  SELECT
    count(*),
    coalesce(avg(avg_mastery), 0),
    count(*) FILTER (WHERE avg_mastery < 50),
    count(*) FILTER (WHERE avg_mastery >= 80)
  INTO v_total_learners, v_avg_readiness, v_at_risk_count, v_exam_ready_count
  FROM learner_mastery;

  -- Per-learner rows
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'user_id', lm.user_id,
    'readiness_pct', round(lm.avg_mastery, 1),
    'confidence', round(lm.avg_confidence, 2),
    'fail_risk_pct', LEAST(100, round((100 - lm.avg_mastery) * (1 + (1 - lm.avg_confidence) * 0.3), 1)),
    'verdict', CASE WHEN lm.avg_mastery >= 80 THEN 'exam_ready' WHEN lm.avg_mastery >= 60 THEN 'almost_ready' WHEN lm.avg_mastery >= 40 THEN 'needs_work' ELSE 'not_ready' END,
    'mastered', lm.mastered,
    'not_mastered', lm.not_mastered
  ) ORDER BY lm.avg_mastery ASC), '[]'::jsonb)
  INTO v_learners
  FROM (
    SELECT li.user_id,
      coalesce(avg(coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0)), 0) as avg_mastery,
      coalesce(avg(coalesce(uss.confidence, 0)), 0) as avg_confidence,
      count(*) FILTER (WHERE uss.mastery_status = 'mastered') as mastered,
      count(*) FILTER (WHERE uss.mastery_status = 'not_mastered' OR uss.mastery_status IS NULL) as not_mastered
    FROM (
      SELECT DISTINCT os.learner_user_id as user_id
      FROM public.organization_seats os
      JOIN public.curricula cur ON cur.id = p_curriculum_id
      WHERE os.seat_status = 'active'
        AND (p_organization_id IS NULL OR os.organization_id = p_organization_id)
        AND (os.certification_id = cur.certification_id OR os.certification_id IS NULL)
    ) li
    CROSS JOIN public.skill_nodes sn
    LEFT JOIN public.user_skill_scores uss ON uss.skill_node_id = sn.id AND uss.user_id = li.user_id
    WHERE sn.curriculum_id = p_curriculum_id
    GROUP BY li.user_id
  ) lm;

  -- Weakest skills across ALL learners (avg mastery per skill)
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.avg_mastery ASC), '[]'::jsonb)
  INTO v_weakest_skills
  FROM (
    SELECT sn.id as skill_node_id, sn.lernfeld, sn.kompetenz,
      round(avg(coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0)), 1) as avg_mastery,
      count(DISTINCT uss.user_id) as learners_with_data
    FROM public.skill_nodes sn
    LEFT JOIN public.user_skill_scores uss ON uss.skill_node_id = sn.id
      AND uss.user_id IN (
        SELECT DISTINCT os.learner_user_id
        FROM public.organization_seats os
        JOIN public.curricula cur ON cur.id = p_curriculum_id
        WHERE os.seat_status = 'active'
          AND (p_organization_id IS NULL OR os.organization_id = p_organization_id)
          AND (os.certification_id = cur.certification_id OR os.certification_id IS NULL)
      )
    WHERE sn.curriculum_id = p_curriculum_id
    GROUP BY sn.id, sn.lernfeld, sn.kompetenz
    HAVING avg(coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0)) < 60
    ORDER BY avg(coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0)) ASC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'curriculum_id', p_curriculum_id,
    'organization_id', p_organization_id,
    'total_learners', v_total_learners,
    'avg_readiness_pct', round(v_avg_readiness, 1),
    'at_risk_count', v_at_risk_count,
    'exam_ready_count', v_exam_ready_count,
    'weakest_skills', v_weakest_skills,
    'learners', v_learners
  );
END;
$$;

-- 3) Organization dashboard: across all curricula
CREATE OR REPLACE FUNCTION public.get_org_competency_dashboard(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curricula jsonb;
  v_total_learners int;
  v_total_at_risk int;
  v_total_exam_ready int;
  v_overall_readiness numeric;
BEGIN
  -- Per-curriculum summary
  WITH active_curricula AS (
    SELECT DISTINCT cur.id as curriculum_id, cur.title
    FROM public.organization_seats os
    JOIN public.curricula cur ON cur.certification_id = os.certification_id
    WHERE os.organization_id = p_organization_id AND os.seat_status = 'active'
  ),
  curriculum_stats AS (
    SELECT
      ac.curriculum_id,
      ac.title,
      count(DISTINCT os.learner_user_id) as learner_count,
      coalesce(avg(coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 0)), 0) as avg_mastery,
      count(DISTINCT os.learner_user_id) FILTER (WHERE sub.avg_m < 50) as at_risk,
      count(DISTINCT os.learner_user_id) FILTER (WHERE sub.avg_m >= 80) as exam_ready
    FROM active_curricula ac
    JOIN public.organization_seats os ON os.certification_id = (SELECT certification_id FROM public.curricula WHERE id = ac.curriculum_id)
      AND os.organization_id = p_organization_id AND os.seat_status = 'active'
    LEFT JOIN LATERAL (
      SELECT coalesce(avg(coalesce(u2.decay_adjusted_mastery, u2.mastery_pct, 0)), 0) as avg_m
      FROM public.skill_nodes sn2
      LEFT JOIN public.user_skill_scores u2 ON u2.skill_node_id = sn2.id AND u2.user_id = os.learner_user_id
      WHERE sn2.curriculum_id = ac.curriculum_id
    ) sub ON true
    LEFT JOIN public.skill_nodes sn ON sn.curriculum_id = ac.curriculum_id
    LEFT JOIN public.user_skill_scores uss ON uss.skill_node_id = sn.id AND uss.user_id = os.learner_user_id
    GROUP BY ac.curriculum_id, ac.title
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'curriculum_id', cs.curriculum_id,
      'title', cs.title,
      'learner_count', cs.learner_count,
      'avg_readiness_pct', round(cs.avg_mastery, 1),
      'at_risk_count', cs.at_risk,
      'exam_ready_count', cs.exam_ready
    ) ORDER BY cs.avg_mastery ASC), '[]'::jsonb),
    coalesce(sum(cs.learner_count), 0),
    coalesce(sum(cs.at_risk), 0),
    coalesce(sum(cs.exam_ready), 0),
    coalesce(avg(cs.avg_mastery), 0)
  INTO v_curricula, v_total_learners, v_total_at_risk, v_total_exam_ready, v_overall_readiness
  FROM curriculum_stats cs;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'total_learners', v_total_learners,
    'overall_readiness_pct', round(v_overall_readiness, 1),
    'total_at_risk', v_total_at_risk,
    'total_exam_ready', v_total_exam_ready,
    'curricula', v_curricula
  );
END;
$$;
