
CREATE TABLE IF NOT EXISTS public.workflow_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES public.berufs_ki_workflow_runs(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.berufs_ki_workflow_definitions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome_type text NOT NULL,
  outcome_score numeric NOT NULL CHECK (outcome_score >= 0 AND outcome_score <= 100),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  estimated_time_saved_min integer NOT NULL DEFAULT 0,
  risk_reduction_pct numeric,
  competency_impact_pct numeric,
  business_impact_label text,
  learner_impact_label text,
  recommended_next_action_key text,
  recommended_next_action_label text,
  recommended_next_action_target text,
  computed_factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_outcomes_user ON public.workflow_outcomes(user_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_outcomes_workflow ON public.workflow_outcomes(workflow_id, computed_at DESC);

ALTER TABLE public.workflow_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_outcomes_owner_read" ON public.workflow_outcomes;
CREATE POLICY "workflow_outcomes_owner_read"
  ON public.workflow_outcomes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.fn_compute_workflow_outcome(_run_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.berufs_ki_workflow_runs%ROWTYPE;
  v_def public.berufs_ki_workflow_definitions%ROWTYPE;
  v_outcome_type text;
  v_score numeric;
  v_confidence numeric;
  v_time_saved int;
  v_risk_reduction numeric;
  v_competency_impact numeric;
  v_business_label text;
  v_learner_label text;
  v_next_key text;
  v_next_label text;
  v_next_target text;
  v_minutes_const int;
  v_factors jsonb;
  v_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.berufs_ki_workflow_runs WHERE id = _run_id;
  IF NOT FOUND OR v_run.status <> 'ok' THEN RETURN NULL; END IF;

  SELECT * INTO v_def FROM public.berufs_ki_workflow_definitions WHERE id = v_run.workflow_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_outcome_type := CASE v_def.category
    WHEN 'analyse'       THEN 'risk_insight'
    WHEN 'lernhilfe'     THEN 'competency_gain'
    WHEN 'fach'          THEN 'competency_gain'
    WHEN 'kommunikation' THEN 'communication_efficiency'
    WHEN 'dokumentation' THEN 'documentation_efficiency'
    WHEN 'organisation'  THEN 'operations_efficiency'
    ELSE 'general_impact'
  END;

  v_minutes_const := CASE v_def.category
    WHEN 'kommunikation' THEN 12
    WHEN 'analyse'       THEN 25
    WHEN 'dokumentation' THEN 18
    WHEN 'organisation'  THEN 8
    WHEN 'fach'          THEN 15
    WHEN 'lernhilfe'     THEN 10
    ELSE 10
  END;

  v_score := ROUND(
    COALESCE(v_run.quality_score, 65) * 0.6
    + COALESCE(v_run.sections_coverage_pct, 65) * 0.4
  , 1);

  v_confidence := CASE COALESCE(v_run.completion_status, 'unknown')
    WHEN 'complete' THEN 0.9
    WHEN 'partial'  THEN 0.6
    WHEN 'empty'    THEN 0.2
    ELSE 0.5
  END;
  IF v_run.sections_coverage_pct IS NOT NULL THEN
    v_confidence := LEAST(1.0, GREATEST(0.1, (v_confidence + (v_run.sections_coverage_pct/100.0)) / 2.0));
  END IF;

  v_time_saved := GREATEST(1, ROUND(v_minutes_const * (v_score/100.0))::int);

  IF v_outcome_type IN ('risk_insight','competency_gain') THEN
    v_risk_reduction := ROUND(v_score * 0.25, 1);
    v_competency_impact := ROUND(v_score * 0.3, 1);
  END IF;

  IF 'ausbilder' = ANY(v_def.target_roles) OR 'teamleiter' = ANY(v_def.target_roles) THEN
    v_business_label := CASE
      WHEN v_score >= 80 THEN 'Hohe Entlastung im Betrieb'
      WHEN v_score >= 60 THEN 'Spürbare Effizienzgewinne'
      ELSE 'Erste Hinweise erkannt'
    END;
  END IF;

  v_learner_label := CASE
    WHEN v_outcome_type = 'risk_insight' AND v_score >= 75 THEN 'Prüfungsrisiko spürbar reduziert'
    WHEN v_outcome_type = 'competency_gain' AND v_score >= 75 THEN 'Kompetenz messbar gestärkt'
    WHEN v_score >= 75 THEN 'Klares Ergebnis erzielt'
    WHEN v_score >= 50 THEN 'Teilergebnis erreicht'
    ELSE 'Weitere Iteration empfohlen'
  END;

  IF v_outcome_type = 'risk_insight' AND v_score >= 70 THEN
    v_next_key := 'open_recovery_plan';
    v_next_label := 'Recovery-Plan im Trainer öffnen';
    v_next_target := '/app/trainer';
  ELSIF v_outcome_type = 'competency_gain' THEN
    v_next_key := 'practice_competency';
    v_next_label := 'Kompetenz im Trainer üben';
    v_next_target := '/app/trainer';
  ELSIF v_score < 50 THEN
    v_next_key := 'rerun_with_refined_inputs';
    v_next_label := 'Workflow mit präziseren Angaben erneut starten';
  ELSE
    v_next_key := 'review_output';
    v_next_label := 'Ergebnis in den Arbeitsalltag übernehmen';
  END IF;

  v_factors := jsonb_build_object(
    'category', v_def.category,
    'tier_at_run', v_run.tier_at_run,
    'quality_score', v_run.quality_score,
    'coverage_pct', v_run.sections_coverage_pct,
    'completion_status', v_run.completion_status,
    'target_roles', to_jsonb(v_def.target_roles),
    'minutes_const', v_minutes_const,
    'has_curriculum', v_def.curriculum_id IS NOT NULL,
    'has_competency', v_def.competency_id IS NOT NULL
  );

  INSERT INTO public.workflow_outcomes (
    run_id, workflow_id, user_id,
    outcome_type, outcome_score, confidence, estimated_time_saved_min,
    risk_reduction_pct, competency_impact_pct,
    business_impact_label, learner_impact_label,
    recommended_next_action_key, recommended_next_action_label, recommended_next_action_target,
    computed_factors
  ) VALUES (
    v_run.id, v_run.workflow_id, v_run.user_id,
    v_outcome_type, v_score, v_confidence, v_time_saved,
    v_risk_reduction, v_competency_impact,
    v_business_label, v_learner_label,
    v_next_key, v_next_label, v_next_target,
    v_factors
  )
  ON CONFLICT (run_id) DO UPDATE SET
    outcome_type = EXCLUDED.outcome_type,
    outcome_score = EXCLUDED.outcome_score,
    confidence = EXCLUDED.confidence,
    estimated_time_saved_min = EXCLUDED.estimated_time_saved_min,
    risk_reduction_pct = EXCLUDED.risk_reduction_pct,
    competency_impact_pct = EXCLUDED.competency_impact_pct,
    business_impact_label = EXCLUDED.business_impact_label,
    learner_impact_label = EXCLUDED.learner_impact_label,
    recommended_next_action_key = EXCLUDED.recommended_next_action_key,
    recommended_next_action_label = EXCLUDED.recommended_next_action_label,
    recommended_next_action_target = EXCLUDED.recommended_next_action_target,
    computed_factors = EXCLUDED.computed_factors,
    computed_at = now()
  RETURNING id INTO v_id;

  BEGIN
    PERFORM public.fn_emit_audit(
      'workflow_outcome_computed',
      jsonb_build_object(
        'run_id', v_run.id,
        'workflow_id', v_run.workflow_id,
        'user_id', v_run.user_id,
        'outcome_type', v_outcome_type,
        'outcome_score', v_score,
        'confidence', v_confidence
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_compute_workflow_outcome(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_compute_workflow_outcome(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_workflow_outcome(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_trg_compute_outcome_on_run()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ok' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ok') THEN
    BEGIN
      PERFORM public.fn_compute_workflow_outcome(NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_outcome_on_run ON public.berufs_ki_workflow_runs;
CREATE TRIGGER trg_compute_outcome_on_run
AFTER INSERT OR UPDATE OF status ON public.berufs_ki_workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_compute_outcome_on_run();

CREATE OR REPLACE FUNCTION public.learner_get_workflow_outcome(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
  SELECT to_jsonb(o.*) INTO v
  FROM public.workflow_outcomes o
  JOIN public.berufs_ki_workflow_runs r ON r.id = o.run_id
  WHERE o.run_id = _run_id
    AND (r.user_id = v_uid OR has_role(v_uid, 'admin'::app_role));
  IF v IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.learner_get_workflow_outcome(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.learner_get_outcome_impact_summary(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz;
  v_total int;
  v_minutes int;
  v_avg_score numeric;
  v_risk_reduction numeric;
  v_competency_impact numeric;
  v_top_types jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
  v_since := now() - make_interval(days => GREATEST(1, COALESCE(_days, 30)));

  SELECT COUNT(*), COALESCE(SUM(estimated_time_saved_min),0),
         ROUND(AVG(outcome_score)::numeric,1),
         ROUND(AVG(risk_reduction_pct)::numeric,1),
         ROUND(AVG(competency_impact_pct)::numeric,1)
  INTO v_total, v_minutes, v_avg_score, v_risk_reduction, v_competency_impact
  FROM public.workflow_outcomes
  WHERE user_id = v_uid AND computed_at >= v_since;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top_types
  FROM (
    SELECT outcome_type, COUNT(*) AS runs, ROUND(AVG(outcome_score)::numeric,1) AS avg_score
    FROM public.workflow_outcomes
    WHERE user_id = v_uid AND computed_at >= v_since
    GROUP BY outcome_type
    ORDER BY runs DESC LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'window_days', _days,
    'total_outcomes', v_total,
    'minutes_saved', v_minutes,
    'avg_outcome_score', v_avg_score,
    'avg_risk_reduction_pct', v_risk_reduction,
    'avg_competency_impact_pct', v_competency_impact,
    'by_outcome_type', v_top_types
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.learner_get_outcome_impact_summary(int) TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.ops_audit_contract') IS NOT NULL THEN
    INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
    VALUES (
      'workflow_outcome_computed',
      ARRAY['run_id','workflow_id','outcome_type','outcome_score','confidence'],
      'berufs-ki/outcome-engine'
    )
    ON CONFLICT (action_type) DO NOTHING;
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.berufs_ki_workflow_runs
    WHERE status = 'ok'
      AND NOT EXISTS (SELECT 1 FROM public.workflow_outcomes o WHERE o.run_id = berufs_ki_workflow_runs.id)
    LIMIT 5000
  LOOP
    BEGIN PERFORM public.fn_compute_workflow_outcome(r.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
