
-- ============================================================
-- Bridge 14: Cognitive Load & Learning State Intelligence
-- ============================================================

-- 1. learner_cognitive_state
CREATE TABLE IF NOT EXISTS public.learner_cognitive_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  load_level text NOT NULL DEFAULT 'normal' CHECK (load_level IN ('low','normal','elevated','overload')),
  fatigue_score numeric NOT NULL DEFAULT 0 CHECK (fatigue_score >= 0 AND fatigue_score <= 100),
  stability_score numeric NOT NULL DEFAULT 100 CHECK (stability_score >= 0 AND stability_score <= 100),
  last_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_intensity text NOT NULL DEFAULT 'normal' CHECK (recommended_intensity IN ('rest','light','normal','focused')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, curriculum_id)
);

ALTER TABLE public.learner_cognitive_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full cognitive_state" ON public.learner_cognitive_state
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own cognitive_state" ON public.learner_cognitive_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin select cognitive_state" ON public.learner_cognitive_state
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_cognitive_state_load ON public.learner_cognitive_state(load_level, computed_at DESC);

-- 2. learning_session_patterns
CREATE TABLE IF NOT EXISTS public.learning_session_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  session_started_at timestamptz NOT NULL,
  duration_minutes numeric NOT NULL DEFAULT 0,
  accuracy_pct numeric,
  accuracy_delta_pp numeric,
  error_spike_count integer NOT NULL DEFAULT 0,
  time_of_day_bucket text CHECK (time_of_day_bucket IN ('morning','afternoon','evening','late_night')),
  interventions_in_session integer NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_session_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full session_patterns" ON public.learning_session_patterns
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own session_patterns" ON public.learning_session_patterns
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin select session_patterns" ON public.learning_session_patterns
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_session_patterns_user_started
  ON public.learning_session_patterns(user_id, curriculum_id, session_started_at DESC);

-- 3. fatigue_signals
CREATE TABLE IF NOT EXISTS public.fatigue_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  signal_type text NOT NULL CHECK (signal_type IN (
    'cognitive_overload','intervention_fatigue','simulation_burnout',
    'late_night_pattern','stability_decay','recovery_density_high','motivation_drop'
  )),
  severity text NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  signal_value numeric,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.fatigue_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full fatigue_signals" ON public.fatigue_signals
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own fatigue_signals" ON public.fatigue_signals
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin select fatigue_signals" ON public.fatigue_signals
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_fatigue_signals_user_detected
  ON public.fatigue_signals(user_id, curriculum_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fatigue_signals_open
  ON public.fatigue_signals(signal_type, severity) WHERE resolved_at IS NULL;

-- 4. Views (service_role only)
CREATE OR REPLACE VIEW public.v_cognitive_overload_risk AS
SELECT
  user_id, curriculum_id, load_level, fatigue_score, stability_score,
  recommended_intensity, computed_at
FROM public.learner_cognitive_state
WHERE load_level IN ('elevated','overload')
   OR fatigue_score >= 60
   OR stability_score <= 40;

CREATE OR REPLACE VIEW public.v_learning_stability_patterns AS
SELECT
  user_id, curriculum_id,
  COUNT(*)::int AS sessions_14d,
  AVG(accuracy_pct)::numeric(5,2) AS avg_accuracy,
  AVG(accuracy_delta_pp)::numeric(5,2) AS avg_delta_pp,
  SUM(error_spike_count)::int AS total_error_spikes,
  COUNT(*) FILTER (WHERE accuracy_delta_pp < -5)::int AS declining_sessions
FROM public.learning_session_patterns
WHERE session_started_at > now() - interval '14 days'
GROUP BY user_id, curriculum_id;

CREATE OR REPLACE VIEW public.v_recovery_burnout_signals AS
SELECT
  user_id, curriculum_id,
  COUNT(*)::int AS recovery_signals_7d,
  MAX(severity) AS max_severity,
  MAX(detected_at) AS last_detected
FROM public.fatigue_signals
WHERE signal_type IN ('intervention_fatigue','recovery_density_high','simulation_burnout')
  AND detected_at > now() - interval '7 days'
  AND resolved_at IS NULL
GROUP BY user_id, curriculum_id
HAVING COUNT(*) >= 3;

REVOKE ALL ON public.v_cognitive_overload_risk FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_learning_stability_patterns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_recovery_burnout_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cognitive_overload_risk TO service_role;
GRANT SELECT ON public.v_learning_stability_patterns TO service_role;
GRANT SELECT ON public.v_recovery_burnout_signals TO service_role;

-- 5. Recompute function
CREATE OR REPLACE FUNCTION public.fn_recompute_learner_cognitive_state(
  p_user_id uuid, p_curriculum_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sessions int := 0;
  v_avg_delta numeric := 0;
  v_error_spikes int := 0;
  v_declining int := 0;
  v_open_signals int := 0;
  v_recovery_density int := 0;
  v_late_night int := 0;
  v_fatigue numeric := 0;
  v_stability numeric := 100;
  v_load text := 'normal';
  v_intensity text := 'normal';
  v_signals jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*), COALESCE(AVG(accuracy_delta_pp),0),
         COALESCE(SUM(error_spike_count),0),
         COUNT(*) FILTER (WHERE accuracy_delta_pp < -5),
         COUNT(*) FILTER (WHERE time_of_day_bucket = 'late_night')
  INTO v_sessions, v_avg_delta, v_error_spikes, v_declining, v_late_night
  FROM public.learning_session_patterns
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
    AND session_started_at > now() - interval '14 days';

  SELECT COUNT(*) INTO v_open_signals
  FROM public.fatigue_signals
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
    AND resolved_at IS NULL
    AND detected_at > now() - interval '7 days';

  SELECT COUNT(*) INTO v_recovery_density
  FROM public.fatigue_signals
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
    AND signal_type IN ('intervention_fatigue','recovery_density_high')
    AND resolved_at IS NULL
    AND detected_at > now() - interval '7 days';

  -- Empirical scoring (bounded)
  v_fatigue := LEAST(100, GREATEST(0,
    (v_error_spikes * 5) + (v_open_signals * 8) + (v_late_night * 4) + (v_recovery_density * 10)
  ));
  v_stability := GREATEST(0, LEAST(100,
    100 + (v_avg_delta * 2) - (v_declining * 8) - (v_error_spikes * 3)
  ));

  IF v_fatigue >= 75 OR v_stability <= 25 THEN
    v_load := 'overload'; v_intensity := 'rest';
  ELSIF v_fatigue >= 50 OR v_stability <= 50 THEN
    v_load := 'elevated'; v_intensity := 'light';
  ELSIF v_sessions = 0 THEN
    v_load := 'low'; v_intensity := 'normal';
  ELSE
    v_load := 'normal'; v_intensity := 'focused';
  END IF;

  v_signals := jsonb_build_object(
    'sessions_14d', v_sessions,
    'avg_delta_pp', v_avg_delta,
    'error_spikes', v_error_spikes,
    'declining_sessions', v_declining,
    'open_signals_7d', v_open_signals,
    'recovery_density_7d', v_recovery_density,
    'late_night_sessions', v_late_night
  );

  INSERT INTO public.learner_cognitive_state
    (user_id, curriculum_id, load_level, fatigue_score, stability_score,
     last_signals, recommended_intensity, computed_at, updated_at)
  VALUES (p_user_id, p_curriculum_id, v_load, v_fatigue, v_stability,
          v_signals, v_intensity, now(), now())
  ON CONFLICT (user_id, curriculum_id) DO UPDATE
    SET load_level = EXCLUDED.load_level,
        fatigue_score = EXCLUDED.fatigue_score,
        stability_score = EXCLUDED.stability_score,
        last_signals = EXCLUDED.last_signals,
        recommended_intensity = EXCLUDED.recommended_intensity,
        computed_at = now(),
        updated_at = now();

  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES ('cognitive_state_recomputed','learner','ok',
      jsonb_build_object('user_id',p_user_id,'curriculum_id',p_curriculum_id,
        'load_level',v_load,'fatigue',v_fatigue,'stability',v_stability));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'load_level', v_load,
    'fatigue_score', v_fatigue,
    'stability_score', v_stability,
    'recommended_intensity', v_intensity,
    'signals', v_signals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recompute_learner_cognitive_state(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recompute_learner_cognitive_state(uuid,uuid) TO service_role;

-- 6. Admin summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_cognitive_load_health()
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
    'state_counts', (
      SELECT jsonb_object_agg(load_level, c) FROM (
        SELECT load_level, COUNT(*)::int AS c
        FROM public.learner_cognitive_state
        GROUP BY load_level
      ) s
    ),
    'overload_risk_total', (SELECT COUNT(*)::int FROM public.learner_cognitive_state WHERE load_level IN ('elevated','overload')),
    'avg_fatigue', (SELECT COALESCE(ROUND(AVG(fatigue_score)::numeric,1),0) FROM public.learner_cognitive_state),
    'avg_stability', (SELECT COALESCE(ROUND(AVG(stability_score)::numeric,1),0) FROM public.learner_cognitive_state),
    'open_signals_by_type', (
      SELECT jsonb_object_agg(signal_type, c) FROM (
        SELECT signal_type, COUNT(*)::int AS c
        FROM public.fatigue_signals
        WHERE resolved_at IS NULL AND detected_at > now() - interval '7 days'
        GROUP BY signal_type
      ) s
    ),
    'open_signals_by_severity', (
      SELECT jsonb_object_agg(severity, c) FROM (
        SELECT severity, COUNT(*)::int AS c
        FROM public.fatigue_signals
        WHERE resolved_at IS NULL AND detected_at > now() - interval '7 days'
        GROUP BY severity
      ) s
    ),
    'burnout_clusters', (SELECT COUNT(*)::int FROM public.v_recovery_burnout_signals),
    'sessions_14d', (SELECT COUNT(*)::int FROM public.learning_session_patterns WHERE session_started_at > now() - interval '14 days'),
    'computed_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_cognitive_load_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_cognitive_load_health() TO authenticated;
