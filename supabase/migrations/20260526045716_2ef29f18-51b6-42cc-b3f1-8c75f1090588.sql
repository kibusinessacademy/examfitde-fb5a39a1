
-- BK-Act-5.2 — Cross-Org Intelligence Layer
-- Extends BK-Act-4 (manager BI) and BK-Act-5.1 (org structure) WITHOUT duplication.
-- All aggregates deterministic from workflow_outcomes + org_member_assignments + user_competency_mastery + org_intervention_events.

-- ============================================================================
-- 1. SCOPING HELPER — resolves which user_ids the caller may see (server-side)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_org_visible_user_ids(_org_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope jsonb;
  v_full boolean;
BEGIN
  IF _user_id IS NULL OR _org_id IS NULL THEN RETURN; END IF;
  v_scope := public.fn_org_user_scope(_user_id, _org_id);
  v_full := COALESCE((v_scope->>'has_full_org_scope')::boolean, false);

  IF v_full THEN
    RETURN QUERY
      SELECT DISTINCT om.user_id
      FROM public.org_memberships om
      WHERE om.org_id = _org_id AND COALESCE(om.is_active, true);
    RETURN;
  END IF;

  RETURN QUERY
    SELECT DISTINCT a.user_id
    FROM public.org_member_assignments a
    WHERE a.org_id = _org_id
      AND COALESCE(a.valid_until, now() + interval '1 year') >= now()
      AND (
        a.site_id = ANY (SELECT (jsonb_array_elements_text(COALESCE(v_scope->'site_ids','[]'::jsonb)))::uuid)
        OR a.department_id = ANY (SELECT (jsonb_array_elements_text(COALESCE(v_scope->'department_ids','[]'::jsonb)))::uuid)
        OR a.cohort_id = ANY (SELECT (jsonb_array_elements_text(COALESCE(v_scope->'cohort_ids','[]'::jsonb)))::uuid)
      );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_org_visible_user_ids(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_org_visible_user_ids(uuid, uuid) TO service_role;

-- ============================================================================
-- 2. AUDIT CONTRACTS — register before any emit
-- ============================================================================
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module, schema_version)
VALUES
  ('cross_org_query',              ARRAY['org_id','surface','window_days'], 'berufs-ki/cross-org-intel', 1),
  ('cohort_trend_query',           ARRAY['org_id','surface','window_days'], 'berufs-ki/cross-org-intel', 1),
  ('recovery_effectiveness_query', ARRAY['org_id','surface','window_days'], 'berufs-ki/cross-org-intel', 1),
  ('intervention_impact_query',    ARRAY['org_id','surface','window_days'], 'berufs-ki/cross-org-intel', 1),
  ('org_quality_query',            ARRAY['org_id','surface','window_days'], 'berufs-ki/cross-org-intel', 1)
ON CONFLICT (action_type) DO NOTHING;

-- ============================================================================
-- 3. CROSS-ORG READINESS — aggregate by site / department / cohort
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_get_cross_org_readiness(_org_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => GREATEST(_days,1));
  v_sites jsonb;
  v_depts jsonb;
  v_cohorts jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'cross_org_readiness') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH visible AS (
    SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid)
  ),
  base AS (
    SELECT
      a.site_id, a.department_id, a.cohort_id, a.user_id,
      o.outcome_score, o.confidence
    FROM public.org_member_assignments a
    JOIN visible v ON v.user_id = a.user_id
    LEFT JOIN public.workflow_outcomes o
      ON o.user_id = a.user_id AND o.computed_at >= v_since
    WHERE a.org_id = _org_id
  )
  SELECT
    (SELECT jsonb_agg(jsonb_build_object(
        'site_id', s.id, 'name', s.name, 'city', s.city,
        'learners', COALESCE(x.learners,0),
        'avg_score', COALESCE(ROUND(x.avg_score::numeric,1),0),
        'runs', COALESCE(x.runs,0),
        'band', CASE WHEN x.avg_score IS NULL THEN 'no_data'
                     WHEN x.avg_score >= 75 THEN 'green'
                     WHEN x.avg_score >= 55 THEN 'amber'
                     ELSE 'red' END
     ) ORDER BY x.avg_score DESC NULLS LAST)
     FROM public.org_sites s
     LEFT JOIN (
       SELECT site_id, COUNT(DISTINCT user_id) AS learners,
              AVG(outcome_score) AS avg_score, COUNT(outcome_score) AS runs
       FROM base WHERE site_id IS NOT NULL GROUP BY site_id
     ) x ON x.site_id = s.id
     WHERE s.org_id = _org_id AND COALESCE(s.is_active,true)
  ),
  (SELECT jsonb_agg(jsonb_build_object(
        'department_id', d.id, 'name', d.name,
        'learners', COALESCE(x.learners,0),
        'avg_score', COALESCE(ROUND(x.avg_score::numeric,1),0),
        'runs', COALESCE(x.runs,0),
        'band', CASE WHEN x.avg_score IS NULL THEN 'no_data'
                     WHEN x.avg_score >= 75 THEN 'green'
                     WHEN x.avg_score >= 55 THEN 'amber'
                     ELSE 'red' END
     ) ORDER BY x.avg_score DESC NULLS LAST)
     FROM public.org_departments d
     LEFT JOIN (
       SELECT department_id, COUNT(DISTINCT user_id) AS learners,
              AVG(outcome_score) AS avg_score, COUNT(outcome_score) AS runs
       FROM base WHERE department_id IS NOT NULL GROUP BY department_id
     ) x ON x.department_id = d.id
     WHERE d.org_id = _org_id AND COALESCE(d.is_active,true)
  ),
  (SELECT jsonb_agg(jsonb_build_object(
        'cohort_id', c.id, 'name', c.name, 'profession_key', c.profession_key,
        'training_year', c.training_year,
        'learners', COALESCE(x.learners,0),
        'avg_score', COALESCE(ROUND(x.avg_score::numeric,1),0),
        'runs', COALESCE(x.runs,0),
        'band', CASE WHEN x.avg_score IS NULL THEN 'no_data'
                     WHEN x.avg_score >= 75 THEN 'green'
                     WHEN x.avg_score >= 55 THEN 'amber'
                     ELSE 'red' END
     ) ORDER BY x.avg_score DESC NULLS LAST)
     FROM public.org_cohorts c
     LEFT JOIN (
       SELECT cohort_id, COUNT(DISTINCT user_id) AS learners,
              AVG(outcome_score) AS avg_score, COUNT(outcome_score) AS runs
       FROM base WHERE cohort_id IS NOT NULL GROUP BY cohort_id
     ) x ON x.cohort_id = c.id
     WHERE c.org_id = _org_id AND COALESCE(c.is_active,true)
  )
  INTO v_sites, v_depts, v_cohorts;

  PERFORM public.fn_emit_audit('cross_org_query','org',_org_id::text,'ok',
    jsonb_build_object('org_id',_org_id,'surface','cross_org_readiness','window_days',_days),
    'manager_get_cross_org_readiness', NULL);

  RETURN jsonb_build_object(
    'org_id',_org_id,'window_days',_days,
    'sites', COALESCE(v_sites,'[]'::jsonb),
    'departments', COALESCE(v_depts,'[]'::jsonb),
    'cohorts', COALESCE(v_cohorts,'[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_get_cross_org_readiness(uuid, integer) TO authenticated;

-- ============================================================================
-- 4. SITE COMPARISON — rank-order metrics across sites
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_get_site_comparison(_org_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => GREATEST(_days,1));
  v_rows jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'site_comparison') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH visible AS (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid)),
  agg AS (
    SELECT a.site_id,
           COUNT(DISTINCT a.user_id) AS learners,
           COUNT(DISTINCT o.user_id) FILTER (WHERE o.computed_at >= v_since) AS active_learners,
           AVG(o.outcome_score) FILTER (WHERE o.computed_at >= v_since) AS avg_score,
           AVG(o.confidence) FILTER (WHERE o.computed_at >= v_since) AS avg_conf,
           AVG(o.risk_reduction_pct) FILTER (WHERE o.computed_at >= v_since AND o.risk_reduction_pct IS NOT NULL) AS avg_risk_red,
           COUNT(o.id) FILTER (WHERE o.computed_at >= v_since) AS runs
    FROM public.org_member_assignments a
    JOIN visible v ON v.user_id = a.user_id
    LEFT JOIN public.workflow_outcomes o ON o.user_id = a.user_id
    WHERE a.org_id = _org_id AND a.site_id IS NOT NULL
    GROUP BY a.site_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'site_id', s.id, 'name', s.name, 'city', s.city, 'region', s.region,
    'learners', COALESCE(g.learners,0),
    'active_learners', COALESCE(g.active_learners,0),
    'activity_pct', CASE WHEN COALESCE(g.learners,0)=0 THEN 0
                         ELSE ROUND((COALESCE(g.active_learners,0)::numeric / g.learners) * 100, 1) END,
    'avg_score', COALESCE(ROUND(g.avg_score::numeric,1),0),
    'avg_confidence', COALESCE(ROUND((g.avg_conf*100)::numeric,1),0),
    'avg_risk_reduction', COALESCE(ROUND(g.avg_risk_red::numeric,1),0),
    'runs', COALESCE(g.runs,0),
    'band', CASE WHEN g.avg_score IS NULL THEN 'no_data'
                 WHEN g.avg_score >= 75 THEN 'green'
                 WHEN g.avg_score >= 55 THEN 'amber'
                 ELSE 'red' END
  ) ORDER BY g.avg_score DESC NULLS LAST)
  INTO v_rows
  FROM public.org_sites s
  LEFT JOIN agg g ON g.site_id = s.id
  WHERE s.org_id = _org_id AND COALESCE(s.is_active,true);

  PERFORM public.fn_emit_audit('cross_org_query','org',_org_id::text,'ok',
    jsonb_build_object('org_id',_org_id,'surface','site_comparison','window_days',_days),
    'manager_get_site_comparison', NULL);

  RETURN jsonb_build_object('org_id',_org_id,'window_days',_days,'rows',COALESCE(v_rows,'[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_get_site_comparison(uuid, integer) TO authenticated;

-- ============================================================================
-- 5. COHORT TRENDS — current vs previous window delta
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_get_cohort_trends(_org_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_days integer := GREATEST(_days,1);
  v_now_since timestamptz := now() - make_interval(days => v_days);
  v_prev_since timestamptz := now() - make_interval(days => v_days*2);
  v_rows jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'cohort_trends') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH visible AS (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid)),
  cur AS (
    SELECT a.cohort_id,
           AVG(o.outcome_score) AS avg_score,
           AVG(o.confidence) AS avg_conf,
           COUNT(DISTINCT o.user_id) AS active_learners,
           COUNT(o.id) AS runs
    FROM public.org_member_assignments a
    JOIN visible v ON v.user_id = a.user_id
    JOIN public.workflow_outcomes o ON o.user_id = a.user_id AND o.computed_at >= v_now_since
    WHERE a.org_id = _org_id AND a.cohort_id IS NOT NULL
    GROUP BY a.cohort_id
  ),
  prev AS (
    SELECT a.cohort_id,
           AVG(o.outcome_score) AS avg_score,
           COUNT(o.id) AS runs
    FROM public.org_member_assignments a
    JOIN visible v ON v.user_id = a.user_id
    JOIN public.workflow_outcomes o ON o.user_id = a.user_id
      AND o.computed_at >= v_prev_since AND o.computed_at < v_now_since
    WHERE a.org_id = _org_id AND a.cohort_id IS NOT NULL
    GROUP BY a.cohort_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'cohort_id', c.id, 'name', c.name,
    'profession_key', c.profession_key, 'training_year', c.training_year,
    'avg_score', COALESCE(ROUND(cur.avg_score::numeric,1),0),
    'avg_score_prev', COALESCE(ROUND(prev.avg_score::numeric,1),0),
    'delta', COALESCE(ROUND((cur.avg_score - prev.avg_score)::numeric,1),0),
    'avg_confidence', COALESCE(ROUND((cur.avg_conf*100)::numeric,1),0),
    'active_learners', COALESCE(cur.active_learners,0),
    'runs', COALESCE(cur.runs,0),
    'trend', CASE
      WHEN cur.avg_score IS NULL OR prev.avg_score IS NULL THEN 'unknown'
      WHEN cur.avg_score - prev.avg_score >= 3 THEN 'improvement'
      WHEN cur.avg_score - prev.avg_score <= -3 THEN 'decline'
      ELSE 'stagnation'
    END,
    'band', CASE WHEN cur.avg_score IS NULL THEN 'no_data'
                 WHEN cur.avg_score >= 75 THEN 'green'
                 WHEN cur.avg_score >= 55 THEN 'amber'
                 ELSE 'red' END
  ) ORDER BY (cur.avg_score - prev.avg_score) DESC NULLS LAST)
  INTO v_rows
  FROM public.org_cohorts c
  LEFT JOIN cur ON cur.cohort_id = c.id
  LEFT JOIN prev ON prev.cohort_id = c.id
  WHERE c.org_id = _org_id AND COALESCE(c.is_active,true);

  PERFORM public.fn_emit_audit('cohort_trend_query','org',_org_id::text,'ok',
    jsonb_build_object('org_id',_org_id,'surface','cohort_trends','window_days',_days),
    'manager_get_cohort_trends', NULL);

  RETURN jsonb_build_object('org_id',_org_id,'window_days',_days,'rows',COALESCE(v_rows,'[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_get_cohort_trends(uuid, integer) TO authenticated;

-- ============================================================================
-- 6. RECOVERY EFFECTIVENESS — risk-reduction / competency impact aggregates
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_get_recovery_effectiveness(_org_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => GREATEST(_days,1));
  v_by_site jsonb;
  v_by_cohort jsonb;
  v_total jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'recovery_effectiveness') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH visible AS (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid)),
  base AS (
    SELECT a.site_id, a.cohort_id, a.user_id,
           o.risk_reduction_pct, o.competency_impact_pct, o.confidence, o.outcome_score
    FROM public.org_member_assignments a
    JOIN visible v ON v.user_id = a.user_id
    JOIN public.workflow_outcomes o ON o.user_id = a.user_id
      AND o.computed_at >= v_since
      AND (o.risk_reduction_pct IS NOT NULL OR o.competency_impact_pct IS NOT NULL)
    WHERE a.org_id = _org_id
  )
  SELECT
    jsonb_build_object(
      'avg_risk_reduction', COALESCE(ROUND(AVG(risk_reduction_pct)::numeric,1),0),
      'avg_competency_impact', COALESCE(ROUND(AVG(competency_impact_pct)::numeric,1),0),
      'avg_confidence', COALESCE(ROUND((AVG(confidence)*100)::numeric,1),0),
      'sample_size', COUNT(*),
      'learners', COUNT(DISTINCT user_id)
    )
  INTO v_total FROM base;

  SELECT jsonb_agg(jsonb_build_object(
    'site_id', s.id, 'name', s.name,
    'avg_risk_reduction', COALESCE(ROUND(g.r::numeric,1),0),
    'avg_competency_impact', COALESCE(ROUND(g.c::numeric,1),0),
    'sample_size', COALESCE(g.n,0),
    'band', CASE WHEN g.r IS NULL THEN 'no_data'
                 WHEN g.r >= 25 THEN 'green'
                 WHEN g.r >= 10 THEN 'amber'
                 ELSE 'red' END
  ) ORDER BY g.r DESC NULLS LAST)
  INTO v_by_site
  FROM public.org_sites s
  LEFT JOIN (
    SELECT site_id, AVG(risk_reduction_pct) r, AVG(competency_impact_pct) c, COUNT(*) n
    FROM (SELECT a.site_id, o.risk_reduction_pct, o.competency_impact_pct
          FROM public.org_member_assignments a
          JOIN (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid)) vv ON vv.user_id=a.user_id
          JOIN public.workflow_outcomes o ON o.user_id=a.user_id AND o.computed_at >= v_since
          WHERE a.org_id=_org_id AND a.site_id IS NOT NULL) z
    GROUP BY site_id
  ) g ON g.site_id = s.id
  WHERE s.org_id = _org_id AND COALESCE(s.is_active,true);

  SELECT jsonb_agg(jsonb_build_object(
    'cohort_id', c.id, 'name', c.name,
    'avg_risk_reduction', COALESCE(ROUND(g.r::numeric,1),0),
    'avg_competency_impact', COALESCE(ROUND(g.c::numeric,1),0),
    'sample_size', COALESCE(g.n,0),
    'band', CASE WHEN g.r IS NULL THEN 'no_data'
                 WHEN g.r >= 25 THEN 'green'
                 WHEN g.r >= 10 THEN 'amber'
                 ELSE 'red' END
  ) ORDER BY g.r DESC NULLS LAST)
  INTO v_by_cohort
  FROM public.org_cohorts c
  LEFT JOIN (
    SELECT cohort_id, AVG(risk_reduction_pct) r, AVG(competency_impact_pct) c, COUNT(*) n
    FROM (SELECT a.cohort_id, o.risk_reduction_pct, o.competency_impact_pct
          FROM public.org_member_assignments a
          JOIN (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid)) vv ON vv.user_id=a.user_id
          JOIN public.workflow_outcomes o ON o.user_id=a.user_id AND o.computed_at >= v_since
          WHERE a.org_id=_org_id AND a.cohort_id IS NOT NULL) z
    GROUP BY cohort_id
  ) g ON g.cohort_id = c.id
  WHERE c.org_id = _org_id AND COALESCE(c.is_active,true);

  PERFORM public.fn_emit_audit('recovery_effectiveness_query','org',_org_id::text,'ok',
    jsonb_build_object('org_id',_org_id,'surface','recovery_effectiveness','window_days',_days),
    'manager_get_recovery_effectiveness', NULL);

  RETURN jsonb_build_object(
    'org_id',_org_id,'window_days',_days,
    'total', v_total,
    'by_site', COALESCE(v_by_site,'[]'::jsonb),
    'by_cohort', COALESCE(v_by_cohort,'[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_get_recovery_effectiveness(uuid, integer) TO authenticated;

-- ============================================================================
-- 7. INTERVENTION IMPACT — workflow_outcomes.recommended_next_action_key as proxy
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_get_intervention_impact(_org_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => GREATEST(_days,1));
  v_rows jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'intervention_impact') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH visible AS (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid)),
  base AS (
    SELECT o.recommended_next_action_key AS action_key,
           o.outcome_score, o.confidence, o.risk_reduction_pct, o.user_id
    FROM public.workflow_outcomes o
    JOIN visible v ON v.user_id = o.user_id
    WHERE o.computed_at >= v_since
      AND o.recommended_next_action_key IS NOT NULL
  )
  SELECT jsonb_agg(jsonb_build_object(
    'action_key', action_key,
    'sample_size', n,
    'learners', learners,
    'avg_outcome_score', ROUND(s::numeric,1),
    'avg_confidence', ROUND((c*100)::numeric,1),
    'avg_risk_reduction', ROUND(COALESCE(r,0)::numeric,1),
    'band', CASE WHEN s >= 75 THEN 'green'
                 WHEN s >= 55 THEN 'amber'
                 ELSE 'red' END
  ) ORDER BY s DESC NULLS LAST)
  INTO v_rows
  FROM (
    SELECT action_key,
           COUNT(*) n, COUNT(DISTINCT user_id) learners,
           AVG(outcome_score) s, AVG(confidence) c, AVG(risk_reduction_pct) r
    FROM base GROUP BY action_key
    HAVING COUNT(*) >= 1
  ) g;

  PERFORM public.fn_emit_audit('intervention_impact_query','org',_org_id::text,'ok',
    jsonb_build_object('org_id',_org_id,'surface','intervention_impact','window_days',_days),
    'manager_get_intervention_impact', NULL);

  RETURN jsonb_build_object('org_id',_org_id,'window_days',_days,'rows',COALESCE(v_rows,'[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_get_intervention_impact(uuid, integer) TO authenticated;

-- ============================================================================
-- 8. COMPETENCY CLUSTER RISK — via outcome_type=competency_gain
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_get_competency_cluster_risk(_org_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => GREATEST(_days,1));
  v_rows jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'competency_cluster_risk') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH visible AS (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid))
  SELECT jsonb_agg(jsonb_build_object(
    'outcome_type', outcome_type,
    'sample_size', n,
    'learners', learners,
    'avg_score', ROUND(s::numeric,1),
    'low_share_pct', ROUND(low_share::numeric,1),
    'band', CASE WHEN low_share >= 30 THEN 'red'
                 WHEN low_share >= 15 THEN 'amber'
                 ELSE 'green' END
  ) ORDER BY low_share DESC)
  INTO v_rows
  FROM (
    SELECT o.outcome_type,
           COUNT(*) n,
           COUNT(DISTINCT o.user_id) learners,
           AVG(o.outcome_score) s,
           (COUNT(*) FILTER (WHERE o.outcome_score < 55))::numeric / NULLIF(COUNT(*),0) * 100 AS low_share
    FROM public.workflow_outcomes o
    JOIN visible v ON v.user_id = o.user_id
    WHERE o.computed_at >= v_since
    GROUP BY o.outcome_type
  ) g;

  PERFORM public.fn_emit_audit('cross_org_query','org',_org_id::text,'ok',
    jsonb_build_object('org_id',_org_id,'surface','competency_cluster_risk','window_days',_days),
    'manager_get_competency_cluster_risk', NULL);

  RETURN jsonb_build_object('org_id',_org_id,'window_days',_days,'rows',COALESCE(v_rows,'[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_get_competency_cluster_risk(uuid, integer) TO authenticated;

-- ============================================================================
-- 9. ORG TRAINING QUALITY SCORE — composite aggregate across all sites/cohorts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manager_get_org_training_quality(_org_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => GREATEST(_days,1));
  v_outcome numeric; v_conf numeric; v_activity numeric; v_risk_vis numeric;
  v_total_learners integer; v_active integer; v_score numeric;
  v_top_site jsonb; v_critical_cohort jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'org_training_quality') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH visible AS (SELECT user_id FROM public.fn_org_visible_user_ids(_org_id, v_uid))
  SELECT
    AVG(o.outcome_score),
    AVG(o.confidence) * 100,
    COUNT(DISTINCT o.user_id),
    AVG(CASE WHEN o.risk_reduction_pct IS NOT NULL THEN 100 ELSE 0 END)
  INTO v_outcome, v_conf, v_active, v_risk_vis
  FROM public.workflow_outcomes o
  JOIN visible v ON v.user_id = o.user_id
  WHERE o.computed_at >= v_since;

  SELECT COUNT(*) INTO v_total_learners FROM public.fn_org_visible_user_ids(_org_id, v_uid);

  v_activity := CASE WHEN v_total_learners = 0 THEN 0
                     ELSE (COALESCE(v_active,0)::numeric / v_total_learners) * 100 END;

  v_score := COALESCE(v_outcome,0)*0.40
           + COALESCE(v_conf,0)*0.20
           + v_activity*0.25
           + COALESCE(v_risk_vis,0)*0.15;

  -- Insight cards
  SELECT to_jsonb(t.*) INTO v_top_site FROM (
    SELECT s.id AS site_id, s.name, ROUND(AVG(o.outcome_score)::numeric,1) AS avg_score
    FROM public.org_sites s
    JOIN public.org_member_assignments a ON a.site_id=s.id
    JOIN public.fn_org_visible_user_ids(_org_id, v_uid) vv ON vv.user_id=a.user_id
    JOIN public.workflow_outcomes o ON o.user_id=a.user_id AND o.computed_at >= v_since
    WHERE s.org_id=_org_id AND COALESCE(s.is_active,true)
    GROUP BY s.id, s.name
    ORDER BY AVG(o.outcome_score) DESC NULLS LAST
    LIMIT 1
  ) t;

  SELECT to_jsonb(t.*) INTO v_critical_cohort FROM (
    SELECT c.id AS cohort_id, c.name, ROUND(AVG(o.outcome_score)::numeric,1) AS avg_score
    FROM public.org_cohorts c
    JOIN public.org_member_assignments a ON a.cohort_id=c.id
    JOIN public.fn_org_visible_user_ids(_org_id, v_uid) vv ON vv.user_id=a.user_id
    JOIN public.workflow_outcomes o ON o.user_id=a.user_id AND o.computed_at >= v_since
    WHERE c.org_id=_org_id AND COALESCE(c.is_active,true)
    GROUP BY c.id, c.name
    HAVING COUNT(o.id) >= 3
    ORDER BY AVG(o.outcome_score) ASC NULLS LAST
    LIMIT 1
  ) t;

  PERFORM public.fn_emit_audit('org_quality_query','org',_org_id::text,'ok',
    jsonb_build_object('org_id',_org_id,'surface','org_training_quality','window_days',_days),
    'manager_get_org_training_quality', NULL);

  RETURN jsonb_build_object(
    'org_id',_org_id,'window_days',_days,
    'org_training_quality_score', ROUND(v_score::numeric,1),
    'band', CASE WHEN v_score >= 75 THEN 'green'
                 WHEN v_score >= 55 THEN 'amber'
                 ELSE 'red' END,
    'breakdown', jsonb_build_array(
      jsonb_build_object('key','outcome','label','Outcomes','value',ROUND(COALESCE(v_outcome,0)::numeric,1),'weight_pct',40),
      jsonb_build_object('key','confidence','label','Confidence','value',ROUND(COALESCE(v_conf,0)::numeric,1),'weight_pct',20),
      jsonb_build_object('key','activity','label','Activity','value',ROUND(v_activity::numeric,1),'weight_pct',25),
      jsonb_build_object('key','risk_visibility','label','Risk Visibility','value',ROUND(COALESCE(v_risk_vis,0)::numeric,1),'weight_pct',15)
    ),
    'total_learners', v_total_learners,
    'active_learners', COALESCE(v_active,0),
    'insights', jsonb_build_object(
      'top_site', v_top_site,
      'critical_cohort', v_critical_cohort
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manager_get_org_training_quality(uuid, integer) TO authenticated;
