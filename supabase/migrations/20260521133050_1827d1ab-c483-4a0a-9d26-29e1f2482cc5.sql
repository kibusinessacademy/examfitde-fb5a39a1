
-- L2 — AI Evaluation Engine

CREATE TABLE IF NOT EXISTS public.ai_eval_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  name text NOT NULL,
  description text,
  item_count int NOT NULL DEFAULT 0,
  gold_source text NOT NULL DEFAULT 'curated',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_eval_datasets_kind_chk CHECK (kind IN (
    'tutor_accuracy','grounding_coverage','oral_realism','recommendation_lift',
    'difficulty_calibration','sequencing_quality','intervention_effectiveness','semantic_grounding'))
);

CREATE TABLE IF NOT EXISTS public.ai_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES public.ai_eval_datasets(id) ON DELETE CASCADE,
  model text NOT NULL DEFAULT 'unknown',
  job_type text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  notes text,
  CONSTRAINT ai_eval_runs_status_chk CHECK (status IN ('pending','running','succeeded','failed'))
);
CREATE INDEX IF NOT EXISTS idx_ai_eval_runs_dataset_time ON public.ai_eval_runs (dataset_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_eval_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ai_eval_runs(id) ON DELETE CASCADE,
  metric text NOT NULL,
  value numeric NOT NULL,
  ci_low numeric,
  ci_high numeric,
  sample_size int,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_eval_scores_run_metric ON public.ai_eval_scores (run_id, metric);

CREATE TABLE IF NOT EXISTS public.ai_regression_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric text NOT NULL,
  model text NOT NULL,
  baseline_value numeric,
  current_value numeric,
  delta numeric GENERATED ALWAYS AS (COALESCE(current_value,0)-COALESCE(baseline_value,0)) STORED,
  regression_flag boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_regression_windows_uk UNIQUE (metric, model)
);

ALTER TABLE public.ai_eval_datasets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_eval_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_eval_scores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_regression_windows  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aed_admin_read" ON public.ai_eval_datasets       FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "aed_svc_write"  ON public.ai_eval_datasets       TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "aer_admin_read" ON public.ai_eval_runs           FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "aer_svc_write"  ON public.ai_eval_runs           TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "aes_admin_read" ON public.ai_eval_scores         FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "aes_svc_write"  ON public.ai_eval_scores         TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "arw_admin_read" ON public.ai_regression_windows  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "arw_svc_write"  ON public.ai_regression_windows  TO service_role USING (true) WITH CHECK (true);

-- Service-role internal state update: record a complete eval run + refresh regression window
CREATE OR REPLACE FUNCTION public.fn_record_ai_eval_run(
  p_dataset_key text,
  p_model text,
  p_job_type text,
  p_scores jsonb,          -- array of {metric, value, ci_low?, ci_high?, sample_size?}
  p_status text DEFAULT 'succeeded',
  p_notes text DEFAULT NULL,
  p_regression_threshold numeric DEFAULT -0.05
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dataset_id uuid;
  v_run_id uuid;
  v_score jsonb;
  v_baseline numeric;
BEGIN
  SELECT id INTO v_dataset_id FROM public.ai_eval_datasets WHERE dataset_key = p_dataset_key;
  IF v_dataset_id IS NULL THEN RAISE EXCEPTION 'unknown dataset_key %', p_dataset_key; END IF;

  INSERT INTO public.ai_eval_runs(dataset_id, model, job_type, status, finished_at, notes)
  VALUES (v_dataset_id, p_model, p_job_type, p_status,
          CASE WHEN p_status IN ('succeeded','failed') THEN now() END, p_notes)
  RETURNING id INTO v_run_id;

  FOR v_score IN SELECT * FROM jsonb_array_elements(p_scores)
  LOOP
    INSERT INTO public.ai_eval_scores(run_id, metric, value, ci_low, ci_high, sample_size)
    VALUES (v_run_id, v_score->>'metric', (v_score->>'value')::numeric,
            NULLIF(v_score->>'ci_low','')::numeric,
            NULLIF(v_score->>'ci_high','')::numeric,
            NULLIF(v_score->>'sample_size','')::int);

    -- Refresh regression window for this (metric, model)
    SELECT baseline_value INTO v_baseline
      FROM public.ai_regression_windows
     WHERE metric = v_score->>'metric' AND model = p_model;

    INSERT INTO public.ai_regression_windows(metric, model, baseline_value, current_value, regression_flag)
    VALUES (
      v_score->>'metric', p_model,
      COALESCE(v_baseline, (v_score->>'value')::numeric),
      (v_score->>'value')::numeric,
      ((v_score->>'value')::numeric - COALESCE(v_baseline,(v_score->>'value')::numeric)) < p_regression_threshold
    )
    ON CONFLICT (metric, model) DO UPDATE
      SET current_value = EXCLUDED.current_value,
          regression_flag = (EXCLUDED.current_value - public.ai_regression_windows.baseline_value) < p_regression_threshold,
          computed_at = now();
  END LOOP;

  PERFORM public.fn_emit_audit(
    _action_type := 'ai_eval_run_recorded',
    _target_id   := v_run_id::text,
    _payload     := jsonb_build_object(
      'run_id', v_run_id, 'dataset_key', p_dataset_key, 'model', p_model,
      'job_type', p_job_type, 'score_count', jsonb_array_length(p_scores), 'status', p_status));
  RETURN v_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_record_ai_eval_run(text,text,text,jsonb,text,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_ai_eval_run(text,text,text,jsonb,text,text,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_ai_eval_summary(p_limit int DEFAULT 30)
RETURNS TABLE(run_id uuid, dataset_key text, kind text, model text, job_type text,
              status text, started_at timestamptz, finished_at timestamptz,
              score_count bigint, regression_flags bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id, d.dataset_key, d.kind, r.model, r.job_type, r.status,
         r.started_at, r.finished_at,
         (SELECT COUNT(*) FROM public.ai_eval_scores s WHERE s.run_id=r.id),
         (SELECT COUNT(*) FROM public.ai_eval_scores s
          JOIN public.ai_regression_windows w ON w.metric=s.metric AND w.model=r.model
          WHERE s.run_id=r.id AND w.regression_flag)
  FROM public.ai_eval_runs r
  JOIN public.ai_eval_datasets d ON d.id = r.dataset_id
  WHERE public.has_role(auth.uid(),'admin'::app_role)
  ORDER BY r.started_at DESC
  LIMIT GREATEST(p_limit,1);
$$;
REVOKE ALL ON FUNCTION public.admin_get_ai_eval_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ai_eval_summary(int) TO authenticated;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES ('ai_eval_run_recorded',
  ARRAY['run_id','dataset_key','model','job_type','score_count','status'],
  'ai_evaluation_engine')
ON CONFLICT (action_type) DO NOTHING;

-- Seed dataset registry (idempotent)
INSERT INTO public.ai_eval_datasets(dataset_key, kind, name, description) VALUES
 ('tutor_accuracy_v1','tutor_accuracy','AI Tutor Accuracy v1','Grounded-vs-hallucinated answer scoring on curated questions'),
 ('grounding_coverage_v1','grounding_coverage','Grounding Coverage v1','Share of tutor answers with valid [SOURCES] block'),
 ('oral_realism_v1','oral_realism','Oral Exam Realism v1','Examiner-rubric score on simulated oral exams'),
 ('recommendation_lift_v1','recommendation_lift','Recommendation Lift v1','Mastery delta vs. random baseline'),
 ('difficulty_calibration_v1','difficulty_calibration','Difficulty Calibration v1','Expected vs actual fail rate per declared difficulty'),
 ('sequencing_quality_v1','sequencing_quality','Sequencing Quality v1','Time-to-recovery from at_risk to ready'),
 ('intervention_effectiveness_v1','intervention_effectiveness','Intervention Effectiveness v1','Retention/pass-rate lift per intervention type'),
 ('semantic_grounding_v1','semantic_grounding','Semantic Grounding v1','Source-coverage and citation accuracy for generated SEO content')
ON CONFLICT (dataset_key) DO NOTHING;
