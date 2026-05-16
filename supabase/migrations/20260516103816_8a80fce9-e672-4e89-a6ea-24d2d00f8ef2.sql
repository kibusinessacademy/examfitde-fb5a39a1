
-- ============================================================
-- Bridge 16: Predictive Scenario Simulation
-- ============================================================

-- 1. scenario_simulations
CREATE TABLE IF NOT EXISTS public.scenario_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  scenario_key text NOT NULL,
  scenario_type text NOT NULL CHECK (scenario_type IN (
    'status_quo','recovery_choice','missed_sessions',
    'added_simulations','intensification','lf_stabilization','custom'
  )),
  horizon_days integer NOT NULL DEFAULT 14 CHECK (horizon_days > 0 AND horizon_days <= 90),
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','superseded')),
  computed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, curriculum_id, scenario_key)
);

ALTER TABLE public.scenario_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full scenario_simulations" ON public.scenario_simulations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own scenario_simulations" ON public.scenario_simulations
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin select scenario_simulations" ON public.scenario_simulations
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_scenarios_type ON public.scenario_simulations(scenario_type, status);

-- 2. forecast_state_snapshots
CREATE TABLE IF NOT EXISTS public.forecast_state_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES public.scenario_simulations(id) ON DELETE CASCADE,
  horizon_day integer NOT NULL CHECK (horizon_day >= 0 AND horizon_day <= 90),
  readiness_projected numeric CHECK (readiness_projected >= 0 AND readiness_projected <= 100),
  success_probability numeric CHECK (success_probability >= 0 AND success_probability <= 1),
  fatigue_projected numeric CHECK (fatigue_projected >= 0 AND fatigue_projected <= 100),
  risk_projected numeric CHECK (risk_projected >= 0 AND risk_projected <= 100),
  stability_projected numeric CHECK (stability_projected >= 0 AND stability_projected <= 100),
  time_pressure_projected numeric CHECK (time_pressure_projected >= 0 AND time_pressure_projected <= 100),
  confidence_low numeric CHECK (confidence_low >= 0 AND confidence_low <= 1),
  confidence_high numeric CHECK (confidence_high >= 0 AND confidence_high <= 1),
  drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, horizon_day)
);

ALTER TABLE public.forecast_state_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full forecast_snapshots" ON public.forecast_state_snapshots
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own forecast_snapshots" ON public.forecast_state_snapshots
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.scenario_simulations s WHERE s.id = scenario_id AND s.user_id = auth.uid())
  );
CREATE POLICY "admin select forecast_snapshots" ON public.forecast_state_snapshots
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_forecast_scenario_horizon
  ON public.forecast_state_snapshots(scenario_id, horizon_day);

-- 3. path_projection_runs
CREATE TABLE IF NOT EXISTS public.path_projection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  scenario_id uuid REFERENCES public.scenario_simulations(id) ON DELETE SET NULL,
  model_version text NOT NULL DEFAULT 'v1.0-heuristic',
  input_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms integer,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','partial','failed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.path_projection_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full projection_runs" ON public.path_projection_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin select projection_runs" ON public.path_projection_runs
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_projection_runs_user
  ON public.path_projection_runs(user_id, curriculum_id, created_at DESC);

-- 4. Views (service_role only)
CREATE OR REPLACE VIEW public.v_readiness_forecasts AS
SELECT
  s.user_id, s.curriculum_id, s.scenario_key, s.scenario_type, s.horizon_days,
  f.horizon_day,
  f.readiness_projected,
  f.success_probability,
  f.confidence_low, f.confidence_high,
  s.computed_at
FROM public.scenario_simulations s
JOIN public.forecast_state_snapshots f ON f.scenario_id = s.id
WHERE s.status = 'completed';

CREATE OR REPLACE VIEW public.v_projected_failure_paths AS
SELECT
  s.user_id, s.curriculum_id, s.scenario_key, s.scenario_type,
  MIN(f.success_probability)::numeric(5,3) AS min_probability,
  MAX(f.horizon_day) AS horizon_day,
  s.computed_at
FROM public.scenario_simulations s
JOIN public.forecast_state_snapshots f ON f.scenario_id = s.id
WHERE s.status = 'completed'
GROUP BY s.user_id, s.curriculum_id, s.scenario_key, s.scenario_type, s.computed_at
HAVING MIN(f.success_probability) < 0.55;

CREATE OR REPLACE VIEW public.v_intervention_projection_effects AS
WITH base AS (
  SELECT s.user_id, s.curriculum_id, s.scenario_type, s.horizon_days,
         AVG(f.success_probability) AS avg_prob
  FROM public.scenario_simulations s
  JOIN public.forecast_state_snapshots f ON f.scenario_id = s.id
  WHERE s.status = 'completed'
  GROUP BY s.user_id, s.curriculum_id, s.scenario_type, s.horizon_days
)
SELECT
  b.user_id, b.curriculum_id, b.horizon_days,
  b.scenario_type,
  b.avg_prob,
  sq.avg_prob AS status_quo_prob,
  (b.avg_prob - sq.avg_prob)::numeric(5,3) AS delta_vs_status_quo
FROM base b
LEFT JOIN base sq
  ON sq.user_id = b.user_id
 AND sq.curriculum_id = b.curriculum_id
 AND sq.horizon_days = b.horizon_days
 AND sq.scenario_type = 'status_quo'
WHERE b.scenario_type <> 'status_quo';

REVOKE ALL ON public.v_readiness_forecasts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_projected_failure_paths FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_intervention_projection_effects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_readiness_forecasts TO service_role;
GRANT SELECT ON public.v_projected_failure_paths TO service_role;
GRANT SELECT ON public.v_intervention_projection_effects TO service_role;

-- 5. Projection engine (bounded heuristic, v1)
CREATE OR REPLACE FUNCTION public.fn_run_scenario_projection(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_scenario_type text,
  p_horizon_days integer DEFAULT 14,
  p_params jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scenario_id uuid;
  v_scenario_key text;
  v_base_readiness numeric := 50;
  v_base_fatigue numeric := 0;
  v_base_stability numeric := 100;
  v_days_to_exam int;
  v_delta_per_day numeric := 0;
  v_fatigue_per_day numeric := 0;
  v_intervention_lift numeric := 0;
  v_horizons int[] := ARRAY[3,7,14,30];
  v_h int;
  v_r numeric; v_f numeric; v_s numeric; v_prob numeric;
  v_risk numeric; v_tp numeric;
  v_conf_band numeric := 0.10;
  v_drivers jsonb := '[]'::jsonb;
  v_start timestamptz := clock_timestamp();
BEGIN
  IF p_scenario_type NOT IN ('status_quo','recovery_choice','missed_sessions',
    'added_simulations','intensification','lf_stabilization','custom') THEN
    RAISE EXCEPTION 'invalid scenario_type: %', p_scenario_type;
  END IF;

  v_scenario_key := p_scenario_type || '|' || p_horizon_days || 'd';

  -- Snapshot current signals (best-effort; bounded fallbacks)
  BEGIN
    SELECT COALESCE(fatigue_score,0), COALESCE(stability_score,100)
      INTO v_base_fatigue, v_base_stability
    FROM public.learner_cognitive_state
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    SELECT days_to_exam INTO v_days_to_exam
    FROM public.exam_window_states
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Scenario deltas (bounded, transparent)
  CASE p_scenario_type
    WHEN 'status_quo' THEN
      v_delta_per_day := 0.3; v_fatigue_per_day := 0.5;
    WHEN 'recovery_choice' THEN
      v_delta_per_day := 0.8; v_intervention_lift := 4; v_fatigue_per_day := 0.7;
    WHEN 'missed_sessions' THEN
      v_delta_per_day := -0.6; v_fatigue_per_day := -0.3;
      v_conf_band := 0.15;
    WHEN 'added_simulations' THEN
      v_delta_per_day := 0.5; v_intervention_lift := 7; v_fatigue_per_day := 1.2;
    WHEN 'intensification' THEN
      v_delta_per_day := 0.6; v_intervention_lift := 3; v_fatigue_per_day := 2.0;
      v_conf_band := 0.15;
    WHEN 'lf_stabilization' THEN
      v_delta_per_day := 0.9; v_intervention_lift := 6; v_fatigue_per_day := 0.6;
    ELSE
      v_delta_per_day := 0.2; v_fatigue_per_day := 0.5; v_conf_band := 0.20;
  END CASE;

  v_drivers := jsonb_build_array(
    jsonb_build_object('factor','base_fatigue','value',v_base_fatigue),
    jsonb_build_object('factor','base_stability','value',v_base_stability),
    jsonb_build_object('factor','days_to_exam','value',v_days_to_exam),
    jsonb_build_object('factor','scenario_lift','value',v_intervention_lift),
    jsonb_build_object('factor','daily_readiness_delta','value',v_delta_per_day)
  );

  -- UPSERT scenario
  INSERT INTO public.scenario_simulations
    (user_id, curriculum_id, scenario_key, scenario_type, horizon_days,
     assumptions, status, computed_at, updated_at)
  VALUES (p_user_id, p_curriculum_id, v_scenario_key, p_scenario_type, p_horizon_days,
          p_params, 'running', now(), now())
  ON CONFLICT (user_id, curriculum_id, scenario_key) DO UPDATE
    SET scenario_type = EXCLUDED.scenario_type,
        horizon_days = EXCLUDED.horizon_days,
        assumptions = EXCLUDED.assumptions,
        status = 'running',
        updated_at = now()
  RETURNING id INTO v_scenario_id;

  -- Clear old snapshots
  DELETE FROM public.forecast_state_snapshots WHERE scenario_id = v_scenario_id;

  -- Compute snapshots at horizon points (bounded 0..100, prob 0..1)
  FOREACH v_h IN ARRAY v_horizons LOOP
    EXIT WHEN v_h > p_horizon_days;
    v_r := LEAST(100, GREATEST(0, v_base_readiness + (v_delta_per_day * v_h) + v_intervention_lift));
    v_f := LEAST(100, GREATEST(0, v_base_fatigue + (v_fatigue_per_day * v_h)));
    v_s := LEAST(100, GREATEST(0, v_base_stability - (v_h * 0.3) + (v_intervention_lift * 0.5)));
    v_risk := LEAST(100, GREATEST(0, 100 - v_r + (v_f * 0.3)));
    v_tp := CASE WHEN v_days_to_exam IS NULL THEN 0
                 ELSE LEAST(100, GREATEST(0, 100 - ((v_days_to_exam - v_h) * 2)))
            END;
    v_prob := GREATEST(0, LEAST(1, (v_r / 100.0) * 0.85 - (v_f / 200.0) + (v_s / 400.0)));

    INSERT INTO public.forecast_state_snapshots
      (scenario_id, horizon_day, readiness_projected, success_probability,
       fatigue_projected, risk_projected, stability_projected, time_pressure_projected,
       confidence_low, confidence_high, drivers)
    VALUES (v_scenario_id, v_h, v_r, v_prob, v_f, v_risk, v_s, v_tp,
            GREATEST(0, v_prob - v_conf_band), LEAST(1, v_prob + v_conf_band),
            v_drivers);
  END LOOP;

  UPDATE public.scenario_simulations
     SET status = 'completed', computed_at = now(), updated_at = now()
   WHERE id = v_scenario_id;

  INSERT INTO public.path_projection_runs
    (user_id, curriculum_id, scenario_id, model_version, input_signals, drivers, duration_ms, status)
  VALUES (p_user_id, p_curriculum_id, v_scenario_id, 'v1.0-heuristic',
          jsonb_build_object('base_fatigue',v_base_fatigue,'base_stability',v_base_stability,'days_to_exam',v_days_to_exam),
          v_drivers,
          EXTRACT(MILLISECOND FROM clock_timestamp() - v_start)::int,
          'ok');

  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES ('scenario_projection_run','learner','ok',
      jsonb_build_object('user_id',p_user_id,'curriculum_id',p_curriculum_id,
        'scenario_type',p_scenario_type,'horizon_days',p_horizon_days,
        'scenario_id',v_scenario_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'scenario_id', v_scenario_id,
    'scenario_key', v_scenario_key,
    'horizon_days', p_horizon_days,
    'model_version', 'v1.0-heuristic',
    'drivers', v_drivers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_run_scenario_projection(uuid,uuid,text,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_scenario_projection(uuid,uuid,text,integer,jsonb)
  TO service_role;

-- 6. Admin summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_predictive_simulation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'scenario_counts', (
      SELECT jsonb_object_agg(scenario_type, c) FROM (
        SELECT scenario_type, COUNT(*)::int AS c
        FROM public.scenario_simulations
        GROUP BY scenario_type
      ) s
    ),
    'status_counts', (
      SELECT jsonb_object_agg(status, c) FROM (
        SELECT status, COUNT(*)::int AS c
        FROM public.scenario_simulations
        GROUP BY status
      ) s
    ),
    'projected_failure_paths', (SELECT COUNT(*)::int FROM public.v_projected_failure_paths),
    'avg_status_quo_prob', (
      SELECT COALESCE(ROUND(AVG(success_probability)::numeric,3),0)
      FROM public.forecast_state_snapshots f
      JOIN public.scenario_simulations s ON s.id = f.scenario_id
      WHERE s.scenario_type = 'status_quo' AND s.status = 'completed'
    ),
    'top_intervention_effects', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)),'[]'::jsonb)
      FROM (
        SELECT scenario_type, horizon_days,
               AVG(delta_vs_status_quo)::numeric(5,3) AS avg_delta,
               COUNT(*)::int AS n
        FROM public.v_intervention_projection_effects
        WHERE delta_vs_status_quo IS NOT NULL
        GROUP BY scenario_type, horizon_days
        ORDER BY AVG(delta_vs_status_quo) DESC
        LIMIT 6
      ) t
    ),
    'runs_24h', (SELECT COUNT(*)::int FROM public.path_projection_runs WHERE created_at > now() - interval '24 hours'),
    'avg_duration_ms', (SELECT COALESCE(ROUND(AVG(duration_ms)::numeric,1),0) FROM public.path_projection_runs WHERE created_at > now() - interval '24 hours'),
    'computed_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_predictive_simulation_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_predictive_simulation_health() TO authenticated;
