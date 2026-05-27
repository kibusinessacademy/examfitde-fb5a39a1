
-- 1. Recommendation function (deterministic, IMMUTABLE)
CREATE OR REPLACE FUNCTION public.fn_mission_control_recommendation(
  _priority numeric,
  _risk numeric,
  _confidence numeric,
  _conflict_count integer,
  _persona_conflict boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(_risk, 1) >= 0.7
      OR COALESCE(_conflict_count, 0) >= 3
      OR (COALESCE(_persona_conflict, false) AND COALESCE(_priority, 0) < 0.5)
      THEN 'block'
    WHEN COALESCE(_priority, 0) >= 0.7
      AND COALESCE(_risk, 1) < 0.4
      AND COALESCE(_confidence, 0) >= 0.7
      AND COALESCE(_conflict_count, 0) = 0
      AND NOT COALESCE(_persona_conflict, false)
      THEN 'go'
    ELSE 'review'
  END;
$$;

COMMENT ON FUNCTION public.fn_mission_control_recommendation IS
  'Cut 2.6 Mission Control — deterministische go/review/block-Empfehlung. KEIN Auto-Apply.';

-- 2. Cross-proposal conflicts
CREATE OR REPLACE VIEW public.v_cross_proposal_conflicts AS
WITH open_proposals AS (
  SELECT
    p.id,
    p.proposal_key,
    p.title,
    p.vertical_key,
    p.business_intent_id,
    p.affected_scope,
    p.severity,
    p.risk_score,
    p.business_impact_score,
    p.confidence_score,
    public.fn_outcome_fix_priority(
      CASE p.severity
        WHEN 'critical' THEN 1.0::numeric
        WHEN 'high'     THEN 0.8::numeric
        WHEN 'medium'   THEN 0.5::numeric
        WHEN 'low'      THEN 0.25::numeric
        ELSE 0.5::numeric
      END,
      p.business_impact_score,
      p.confidence_score,
      p.risk_score
    ) AS priority_score
  FROM public.outcome_fix_proposals p
  WHERE p.review_state IN ('draft','in_review','changes_requested')
)
SELECT
  a.id  AS proposal_a_id,
  b.id  AS proposal_b_id,
  a.proposal_key AS proposal_a_key,
  b.proposal_key AS proposal_b_key,
  a.title AS proposal_a_title,
  b.title AS proposal_b_title,
  a.vertical_key,
  CASE
    WHEN a.business_intent_id IS NOT NULL
         AND a.business_intent_id = b.business_intent_id
      THEN 'business_intent_overlap'
    WHEN a.affected_scope ?| (SELECT ARRAY(SELECT jsonb_object_keys(b.affected_scope)))
      THEN 'scope_overlap'
    ELSE 'vertical_overlap'
  END AS conflict_type,
  (
    GREATEST(a.business_impact_score, b.business_impact_score) >= 0.7
    AND GREATEST(a.risk_score, b.risk_score) >= 0.6
  ) AS is_high_tension,
  GREATEST(a.priority_score, b.priority_score) AS max_priority,
  GREATEST(a.risk_score, b.risk_score)         AS max_risk
FROM open_proposals a
JOIN open_proposals b
  ON a.vertical_key = b.vertical_key
 AND a.id < b.id
WHERE
  (a.business_intent_id IS NOT NULL AND a.business_intent_id = b.business_intent_id)
  OR (
    jsonb_typeof(a.affected_scope) = 'object'
    AND jsonb_typeof(b.affected_scope) = 'object'
    AND a.affected_scope ?| (SELECT ARRAY(SELECT jsonb_object_keys(b.affected_scope)))
  );

COMMENT ON VIEW public.v_cross_proposal_conflicts IS
  'Cut 2.6 — paarweise Konflikte zwischen offenen Fix-Proposals.';

REVOKE ALL ON public.v_cross_proposal_conflicts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cross_proposal_conflicts TO service_role;

-- 3. Executive decision queue
CREATE OR REPLACE VIEW public.v_executive_decision_queue AS
WITH open_proposals AS (
  SELECT
    p.*,
    public.fn_outcome_fix_priority(
      CASE p.severity
        WHEN 'critical' THEN 1.0::numeric
        WHEN 'high'     THEN 0.8::numeric
        WHEN 'medium'   THEN 0.5::numeric
        WHEN 'low'      THEN 0.25::numeric
        ELSE 0.5::numeric
      END,
      p.business_impact_score,
      p.confidence_score,
      p.risk_score
    ) AS priority_score
  FROM public.outcome_fix_proposals p
  WHERE p.review_state IN ('draft','in_review','changes_requested')
),
conflicts_per_proposal AS (
  SELECT pid, COUNT(*)::int AS conflict_count
  FROM (
    SELECT proposal_a_id AS pid FROM public.v_cross_proposal_conflicts
    UNION ALL
    SELECT proposal_b_id AS pid FROM public.v_cross_proposal_conflicts
  ) u
  GROUP BY pid
),
persona AS (
  SELECT
    proposal_id,
    is_conflicted        AS persona_conflict,
    personas_simulated,
    avg_composite,
    utility_spread
  FROM public.v_outcome_fix_persona_matrix
)
SELECT
  p.id,
  p.proposal_key,
  p.title,
  p.vertical_key,
  p.proposal_type,
  p.proposal_source,
  p.severity,
  p.review_state,
  p.business_intent_id,
  p.finding_id,
  p.priority_score,
  p.risk_score,
  p.business_impact_score,
  p.confidence_score,
  p.expected_kpi_delta_pct_min,
  p.expected_kpi_delta_pct_max,
  COALESCE(c.conflict_count, 0)         AS conflict_count,
  COALESCE(pe.persona_conflict, false)  AS persona_conflict,
  COALESCE(pe.personas_simulated, 0)    AS personas_simulated,
  pe.avg_composite                      AS persona_avg_composite,
  pe.utility_spread                     AS persona_utility_spread,
  public.fn_mission_control_recommendation(
    p.priority_score,
    p.risk_score,
    p.confidence_score,
    COALESCE(c.conflict_count, 0),
    COALESCE(pe.persona_conflict, false)
  ) AS recommendation,
  p.created_at,
  p.updated_at
FROM open_proposals p
LEFT JOIN conflicts_per_proposal c ON c.pid = p.id
LEFT JOIN persona pe              ON pe.proposal_id = p.id;

COMMENT ON VIEW public.v_executive_decision_queue IS
  'Cut 2.6 — Executive Decision Queue mit go/review/block. READ-ONLY.';

REVOKE ALL ON public.v_executive_decision_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_executive_decision_queue TO service_role;

-- 4. Overview RPC
CREATE OR REPLACE FUNCTION public.admin_get_mission_control_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intents_total int; v_intents_active int;
  v_findings_total int; v_findings_open int; v_findings_critical int;
  v_proposals_open int; v_proposals_critical int; v_proposals_avg_priority numeric;
  v_personas_total int; v_simulated_proposals int; v_persona_conflicts int;
  v_conflict_pairs int;
  v_decision_go int; v_decision_review int; v_decision_block int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_active)
    INTO v_intents_total, v_intents_active
  FROM public.business_intents;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('open','acknowledged')),
    COUNT(*) FILTER (WHERE severity = 'critical' AND status IN ('open','acknowledged'))
    INTO v_findings_total, v_findings_open, v_findings_critical
  FROM public.outcome_intelligence_findings;

  SELECT
    COUNT(*) FILTER (WHERE review_state IN ('draft','in_review','changes_requested')),
    COUNT(*) FILTER (WHERE severity = 'critical' AND review_state IN ('draft','in_review','changes_requested')),
    AVG(
      public.fn_outcome_fix_priority(
        CASE severity
          WHEN 'critical' THEN 1.0::numeric
          WHEN 'high'     THEN 0.8::numeric
          WHEN 'medium'   THEN 0.5::numeric
          WHEN 'low'      THEN 0.25::numeric
          ELSE 0.5::numeric
        END,
        business_impact_score, confidence_score, risk_score
      )
    ) FILTER (WHERE review_state IN ('draft','in_review','changes_requested'))
    INTO v_proposals_open, v_proposals_critical, v_proposals_avg_priority
  FROM public.outcome_fix_proposals;

  SELECT COUNT(*) INTO v_personas_total FROM public.persona_registry;

  SELECT
    COUNT(DISTINCT proposal_id),
    COUNT(*) FILTER (WHERE is_conflicted)
    INTO v_simulated_proposals, v_persona_conflicts
  FROM public.v_outcome_fix_persona_matrix;

  SELECT COUNT(*) INTO v_conflict_pairs FROM public.v_cross_proposal_conflicts;

  SELECT
    COUNT(*) FILTER (WHERE recommendation = 'go'),
    COUNT(*) FILTER (WHERE recommendation = 'review'),
    COUNT(*) FILTER (WHERE recommendation = 'block')
    INTO v_decision_go, v_decision_review, v_decision_block
  FROM public.v_executive_decision_queue;

  RETURN jsonb_build_object(
    'business_intents', jsonb_build_object('total', v_intents_total, 'active', v_intents_active),
    'findings', jsonb_build_object(
      'total', v_findings_total, 'open', v_findings_open, 'critical_open', v_findings_critical
    ),
    'fix_proposals', jsonb_build_object(
      'open', v_proposals_open, 'critical_open', v_proposals_critical,
      'avg_priority', v_proposals_avg_priority
    ),
    'personas', jsonb_build_object(
      'registered', v_personas_total,
      'simulated_proposals', v_simulated_proposals,
      'conflicts', v_persona_conflicts
    ),
    'cross_proposal', jsonb_build_object('conflict_pairs', v_conflict_pairs),
    'decision_queue', jsonb_build_object(
      'go', v_decision_go, 'review', v_decision_review, 'block', v_decision_block
    ),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_mission_control_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_mission_control_overview() TO authenticated;

-- 5. Conflicts RPC
CREATE OR REPLACE FUNCTION public.admin_get_cross_proposal_conflicts(
  _vertical_key text DEFAULT NULL,
  _only_high_tension boolean DEFAULT false,
  _limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT *
    FROM public.v_cross_proposal_conflicts c
    WHERE (_vertical_key IS NULL OR c.vertical_key = _vertical_key)
      AND (NOT _only_high_tension OR c.is_high_tension)
    ORDER BY c.is_high_tension DESC, c.max_priority DESC NULLS LAST
    LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_cross_proposal_conflicts(text,boolean,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_cross_proposal_conflicts(text,boolean,int) TO authenticated;

-- 6. Decision Queue RPC
CREATE OR REPLACE FUNCTION public.admin_get_executive_decision_queue(
  _vertical_key text DEFAULT NULL,
  _recommendation text DEFAULT NULL,
  _limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  IF _recommendation IS NOT NULL
     AND _recommendation NOT IN ('go','review','block') THEN
    RAISE EXCEPTION 'invalid recommendation filter: %', _recommendation;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT *
    FROM public.v_executive_decision_queue q
    WHERE (_vertical_key IS NULL OR q.vertical_key = _vertical_key)
      AND (_recommendation IS NULL OR q.recommendation = _recommendation)
    ORDER BY
      CASE q.recommendation WHEN 'block' THEN 0 WHEN 'review' THEN 1 WHEN 'go' THEN 2 ELSE 3 END,
      q.conflict_count DESC,
      q.priority_score DESC NULLS LAST
    LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_executive_decision_queue(text,text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_executive_decision_queue(text,text,int) TO authenticated;
