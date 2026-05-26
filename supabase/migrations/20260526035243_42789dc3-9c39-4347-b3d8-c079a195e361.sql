
-- ============================================================
-- BK-Act-4 — Business Intelligence Layer
-- Deterministische Manager-RPCs aus workflow_outcomes + mastery.
-- ============================================================

-- Helper: gate check + audit emit (DRY)
CREATE OR REPLACE FUNCTION public.fn_manager_bi_gate(_org_id uuid, _surface text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  v_ok := public.is_org_member_with_role(v_uid, _org_id, ARRAY['owner','admin','manager']);
  RETURN v_ok;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_manager_bi_gate(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_manager_bi_gate(uuid,text) TO authenticated;

-- 1) Team Readiness Heatmap
CREATE OR REPLACE FUNCTION public.manager_get_team_readiness_heatmap(_org_id uuid, _days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(_days,30)));
  v_rows jsonb;
  v_cats jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'team_readiness_heatmap') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  -- Columns: 6 outcome_types (deterministic order)
  v_cats := '["risk_insight","competency_gain","communication_efficiency","documentation_efficiency","operations_efficiency","general_impact"]'::jsonb;

  WITH learners AS (
    SELECT m.user_id
    FROM public.org_memberships m
    WHERE m.org_id = _org_id AND m.status = 'active' AND m.role = 'learner'
  ),
  outcomes AS (
    SELECT o.user_id, o.outcome_type,
           AVG(o.outcome_score)::numeric AS avg_score,
           AVG(o.confidence)::numeric AS avg_conf,
           COUNT(*) AS runs
    FROM public.workflow_outcomes o
    JOIN learners l ON l.user_id = o.user_id
    WHERE o.computed_at >= v_since
    GROUP BY o.user_id, o.outcome_type
  ),
  per_user AS (
    SELECT l.user_id,
           jsonb_object_agg(o.outcome_type, jsonb_build_object(
             'avg_score', ROUND(o.avg_score,1),
             'avg_confidence', ROUND(o.avg_conf,2),
             'runs', o.runs,
             'band', CASE
               WHEN o.avg_score >= 75 THEN 'green'
               WHEN o.avg_score >= 55 THEN 'amber'
               ELSE 'red'
             END
           )) FILTER (WHERE o.outcome_type IS NOT NULL) AS cells,
           ROUND(AVG(o.avg_score)::numeric,1) AS overall_score,
           SUM(o.runs)::int AS total_runs
    FROM learners l
    LEFT JOIN outcomes o ON o.user_id = l.user_id
    GROUP BY l.user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', user_id,
    'overall_score', overall_score,
    'overall_band', CASE
      WHEN overall_score IS NULL THEN 'no_data'
      WHEN overall_score >= 75 THEN 'green'
      WHEN overall_score >= 55 THEN 'amber'
      ELSE 'red'
    END,
    'total_runs', COALESCE(total_runs,0),
    'cells', COALESCE(cells, '{}'::jsonb)
  ) ORDER BY COALESCE(overall_score,-1) DESC), '[]'::jsonb)
  INTO v_rows FROM per_user;

  RETURN jsonb_build_object(
    'org_id', _org_id,
    'window_days', _days,
    'columns', v_cats,
    'rows', v_rows,
    'learner_count', (SELECT COUNT(*) FROM public.org_memberships WHERE org_id=_org_id AND status='active' AND role='learner')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.manager_get_team_readiness_heatmap(uuid,int) TO authenticated;

-- 2) Risk Radar
CREATE OR REPLACE FUNCTION public.manager_get_risk_radar(_org_id uuid, _days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(_days,30)));
  v_at_risk int;
  v_stagnant int;
  v_low_recovery int;
  v_low_exam_conf int;
  v_inactive int;
  v_total int;
  v_dimensions jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'risk_radar') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH learners AS (
    SELECT m.user_id FROM public.org_memberships m
    WHERE m.org_id=_org_id AND m.status='active' AND m.role='learner'
  ),
  user_agg AS (
    SELECT l.user_id,
      AVG(o.outcome_score) AS avg_score,
      AVG(o.confidence)    AS avg_conf,
      COUNT(*) FILTER (WHERE o.outcome_type='risk_insight' AND o.outcome_score >= 70) AS risk_runs_high,
      COUNT(*) FILTER (WHERE o.outcome_type='competency_gain' AND o.outcome_score < 55) AS comp_low_runs,
      COUNT(*) AS total_runs,
      MAX(o.computed_at) AS last_at
    FROM learners l
    LEFT JOIN public.workflow_outcomes o
      ON o.user_id = l.user_id AND o.computed_at >= v_since
    GROUP BY l.user_id
  )
  SELECT
    COUNT(*) FILTER (WHERE avg_score IS NOT NULL AND avg_score < 55),
    COUNT(*) FILTER (WHERE total_runs > 0 AND total_runs < 2),
    COUNT(*) FILTER (WHERE comp_low_runs >= 2),
    COUNT(*) FILTER (WHERE avg_conf IS NOT NULL AND avg_conf < 0.5),
    COUNT(*) FILTER (WHERE total_runs = 0 OR last_at < now() - interval '14 days'),
    COUNT(*)
  INTO v_at_risk, v_stagnant, v_low_recovery, v_low_exam_conf, v_inactive, v_total
  FROM user_agg;

  v_dimensions := jsonb_build_array(
    jsonb_build_object('key','at_risk_competency', 'label','Kritische Kompetenz-Cluster',  'value', v_at_risk,         'total', v_total),
    jsonb_build_object('key','stagnant_learners',  'label','Stagnierende Lernentwicklung', 'value', v_stagnant,        'total', v_total),
    jsonb_build_object('key','low_recovery',       'label','Geringe Recovery-Wirkung',      'value', v_low_recovery,    'total', v_total),
    jsonb_build_object('key','low_exam_confidence','label','Hohe Prüfungsunsicherheit',     'value', v_low_exam_conf,   'total', v_total),
    jsonb_build_object('key','inactive_14d',       'label','Inaktive (14 Tage+)',           'value', v_inactive,        'total', v_total)
  );

  RETURN jsonb_build_object(
    'org_id', _org_id,
    'window_days', _days,
    'total_learners', v_total,
    'dimensions', v_dimensions
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.manager_get_risk_radar(uuid,int) TO authenticated;

-- 3) Team AI Impact
CREATE OR REPLACE FUNCTION public.manager_get_team_ai_impact(_org_id uuid, _days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(_days,30)));
  v_runs int;
  v_minutes int;
  v_analyses int;
  v_docs int;
  v_comms int;
  v_risks int;
  v_active_learners int;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'team_ai_impact') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH learners AS (
    SELECT m.user_id FROM public.org_memberships m
    WHERE m.org_id=_org_id AND m.status='active' AND m.role='learner'
  ),
  scoped AS (
    SELECT o.* FROM public.workflow_outcomes o
    JOIN learners l ON l.user_id = o.user_id
    WHERE o.computed_at >= v_since
  )
  SELECT
    COUNT(*),
    COALESCE(SUM(estimated_time_saved_min),0),
    COUNT(*) FILTER (WHERE outcome_type='risk_insight'),
    COUNT(*) FILTER (WHERE outcome_type='documentation_efficiency'),
    COUNT(*) FILTER (WHERE outcome_type='communication_efficiency'),
    COUNT(*) FILTER (WHERE outcome_type='risk_insight' AND outcome_score>=70),
    COUNT(DISTINCT user_id)
  INTO v_runs, v_minutes, v_analyses, v_docs, v_comms, v_risks, v_active_learners
  FROM scoped;

  RETURN jsonb_build_object(
    'org_id', _org_id,
    'window_days', _days,
    'workflows_run', v_runs,
    'minutes_saved', v_minutes,
    'hours_saved', ROUND((v_minutes/60.0)::numeric,1),
    'analyses_automated', v_analyses,
    'documents_assisted', v_docs,
    'communications_assisted', v_comms,
    'risk_signals_detected', v_risks,
    'active_learners', v_active_learners
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.manager_get_team_ai_impact(uuid,int) TO authenticated;

-- 4) Intervention Recommendations (deterministic rules)
CREATE OR REPLACE FUNCTION public.manager_get_intervention_recommendations(_org_id uuid, _days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(_days,30)));
  v_recs jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'intervention_recommendations') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  WITH learners AS (
    SELECT m.user_id FROM public.org_memberships m
    WHERE m.org_id=_org_id AND m.status='active' AND m.role='learner'
  ),
  -- Rule R1: critical competency clusters (≥3 low competency_gain runs)
  r1 AS (
    SELECT 'critical_competency_cluster' AS key,
           'Kompetenz-Cluster kritisch' AS title,
           CONCAT(COUNT(DISTINCT o.user_id), ' Azubis mit wiederholt niedriger Kompetenz-Wirkung — empfohlener Drill im Trainer.') AS detail,
           'open_drill' AS action_key,
           'Drill-Block im Trainer öffnen' AS action_label,
           '/app/trainer' AS action_target,
           CASE WHEN COUNT(DISTINCT o.user_id) >= 3 THEN 'high' ELSE 'medium' END AS severity
    FROM public.workflow_outcomes o
    JOIN learners l ON l.user_id = o.user_id
    WHERE o.computed_at >= v_since
      AND o.outcome_type='competency_gain' AND o.outcome_score < 55
    GROUP BY 1,2,4,5,6
    HAVING COUNT(DISTINCT o.user_id) >= 2
  ),
  -- Rule R2: high exam risk (avg risk_insight score high)
  r2 AS (
    SELECT 'exam_risk_high' AS key,
           'Prüfungsrisiko erhöht' AS title,
           CONCAT(COUNT(DISTINCT o.user_id), ' Azubis mit Risiko-Signalen aus Analyse-Workflows — Recovery-Plan empfohlen.') AS detail,
           'open_recovery' AS action_key,
           'Recovery-Plan einleiten' AS action_label,
           '/app/trainer' AS action_target,
           'high' AS severity
    FROM public.workflow_outcomes o
    JOIN learners l ON l.user_id = o.user_id
    WHERE o.computed_at >= v_since
      AND o.outcome_type='risk_insight' AND o.outcome_score >= 70
    GROUP BY 1,2,4,5,6,7
    HAVING COUNT(DISTINCT o.user_id) >= 1
  ),
  -- Rule R3: oral / fachgespraech preparation gap (low communication_efficiency)
  r3 AS (
    SELECT 'oral_prep_gap' AS key,
           'Mündliche Prüfung trainieren' AS title,
           CONCAT(COUNT(DISTINCT o.user_id), ' Azubis mit schwacher Kommunikations-Wirkung — Fachgespräch-Workflow empfohlen.') AS detail,
           'run_oral_workflow' AS action_key,
           'Fachgespräch-Workflow planen' AS action_label,
           '/app/berufs-ki' AS action_target,
           'medium' AS severity
    FROM public.workflow_outcomes o
    JOIN learners l ON l.user_id = o.user_id
    WHERE o.computed_at >= v_since
      AND o.outcome_type='communication_efficiency' AND o.outcome_score < 60
    GROUP BY 1,2,4,5,6,7
    HAVING COUNT(DISTINCT o.user_id) >= 2
  ),
  -- Rule R4: inactivity (≥14d)
  r4 AS (
    SELECT 'inactive_learners' AS key,
           'Kompetenzgespräch sinnvoll' AS title,
           CONCAT(COUNT(*), ' Azubis seit 14+ Tagen ohne Berufs-KI-Aktivität — kurzes Standortgespräch empfohlen.') AS detail,
           'schedule_checkin' AS action_key,
           'Standortgespräch einplanen' AS action_label,
           NULL::text AS action_target,
           'low' AS severity
    FROM (
      SELECT l.user_id, MAX(o.computed_at) AS last_at
      FROM learners l
      LEFT JOIN public.workflow_outcomes o ON o.user_id = l.user_id
      GROUP BY l.user_id
    ) s
    WHERE s.last_at IS NULL OR s.last_at < now() - interval '14 days'
    HAVING COUNT(*) >= 1
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY CASE r.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END), '[]'::jsonb)
  INTO v_recs
  FROM (
    SELECT * FROM r1 UNION ALL
    SELECT * FROM r2 UNION ALL
    SELECT * FROM r3 UNION ALL
    SELECT * FROM r4
  ) r;

  RETURN jsonb_build_object(
    'org_id', _org_id,
    'window_days', _days,
    'recommendations', v_recs
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.manager_get_intervention_recommendations(uuid,int) TO authenticated;

-- 5) Training Quality Score (composite)
CREATE OR REPLACE FUNCTION public.manager_get_training_quality_score(_org_id uuid, _days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(_days,30)));
  v_total int;
  v_active int;
  v_avg_outcome numeric;
  v_avg_conf numeric;
  v_risk_share numeric;
  v_activity_share numeric;
  v_score numeric;
  v_breakdown jsonb;
BEGIN
  IF NOT public.fn_manager_bi_gate(_org_id, 'training_quality_score') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.org_memberships
   WHERE org_id=_org_id AND status='active' AND role='learner';

  WITH learners AS (
    SELECT m.user_id FROM public.org_memberships m
    WHERE m.org_id=_org_id AND m.status='active' AND m.role='learner'
  ),
  o AS (
    SELECT * FROM public.workflow_outcomes
    WHERE computed_at >= v_since
      AND user_id IN (SELECT user_id FROM learners)
  )
  SELECT
    COUNT(DISTINCT user_id),
    COALESCE(ROUND(AVG(outcome_score)::numeric,1), 0),
    COALESCE(ROUND(AVG(confidence)::numeric,2), 0),
    COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE outcome_type='risk_insight' AND outcome_score >= 70)
                  / NULLIF(COUNT(*),0), 1), 0)
  INTO v_active, v_avg_outcome, v_avg_conf, v_risk_share
  FROM o;

  v_activity_share := CASE WHEN v_total > 0 THEN ROUND(100.0 * v_active / v_total, 1) ELSE 0 END;

  -- Composite (0..100): outcome 40% + confidence 20% + activity 25% + risk_signal_share 15%
  v_score := ROUND(
      v_avg_outcome * 0.40
    + (v_avg_conf * 100) * 0.20
    + v_activity_share * 0.25
    + v_risk_share * 0.15
  , 1);

  v_breakdown := jsonb_build_array(
    jsonb_build_object('key','outcome_quality',   'label','Ergebnis-Qualität',     'value', v_avg_outcome, 'weight_pct', 40),
    jsonb_build_object('key','confidence',        'label','Confidence',            'value', ROUND(v_avg_conf*100,1), 'weight_pct', 20),
    jsonb_build_object('key','activity_share',    'label','Aktive Azubis',         'value', v_activity_share, 'weight_pct', 25),
    jsonb_build_object('key','risk_visibility',   'label','Risiko-Sichtbarkeit',   'value', v_risk_share, 'weight_pct', 15)
  );

  RETURN jsonb_build_object(
    'org_id', _org_id,
    'window_days', _days,
    'training_quality_score', v_score,
    'band', CASE WHEN v_score>=75 THEN 'green' WHEN v_score>=55 THEN 'amber' ELSE 'red' END,
    'total_learners', v_total,
    'active_learners', v_active,
    'breakdown', v_breakdown
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.manager_get_training_quality_score(uuid,int) TO authenticated;

-- 6) Audit contract registration
DO $$ BEGIN
  IF to_regclass('public.ops_audit_contract') IS NOT NULL THEN
    INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
    VALUES ('manager_bi_query', ARRAY['org_id','surface','window_days'], 'berufs-ki/bi-layer')
    ON CONFLICT (action_type) DO NOTHING;
  END IF;
END $$;
