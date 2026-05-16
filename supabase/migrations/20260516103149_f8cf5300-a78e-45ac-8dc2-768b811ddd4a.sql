
-- ============================================================
-- Bridge 15: Temporal & Exam Window Intelligence
-- ============================================================

-- 1. exam_window_states
CREATE TABLE IF NOT EXISTS public.exam_window_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  exam_date date,
  days_to_exam integer,
  phase text NOT NULL DEFAULT 'unscheduled'
    CHECK (phase IN ('unscheduled','early','build','sharpen','taper','final','post')),
  recommended_focus text NOT NULL DEFAULT 'foundation'
    CHECK (recommended_focus IN ('foundation','breadth','depth','simulation','review_only','rest','retro')),
  intensity_recommendation text NOT NULL DEFAULT 'normal'
    CHECK (intensity_recommendation IN ('low','normal','elevated','peak','wind_down')),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, curriculum_id)
);

ALTER TABLE public.exam_window_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full exam_window_states" ON public.exam_window_states
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own exam_window_states" ON public.exam_window_states
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "learner upsert own exam_date" ON public.exam_window_states
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "learner update own exam_date" ON public.exam_window_states
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "admin select exam_window_states" ON public.exam_window_states
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_exam_window_phase ON public.exam_window_states(phase, days_to_exam);

-- 2. temporal_learning_patterns
CREATE TABLE IF NOT EXISTS public.temporal_learning_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  minutes_studied integer NOT NULL DEFAULT 0,
  sessions_count integer NOT NULL DEFAULT 0,
  simulations_done integer NOT NULL DEFAULT 0,
  new_lf_started integer NOT NULL DEFAULT 0,
  intensity_index numeric NOT NULL DEFAULT 0,
  days_to_exam_at_window integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, curriculum_id, window_start)
);

ALTER TABLE public.temporal_learning_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full temporal_patterns" ON public.temporal_learning_patterns
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own temporal_patterns" ON public.temporal_learning_patterns
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin select temporal_patterns" ON public.temporal_learning_patterns
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_temporal_window
  ON public.temporal_learning_patterns(user_id, curriculum_id, window_start DESC);

-- 3. revision_cycles
CREATE TABLE IF NOT EXISTS public.revision_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  competency_id uuid NOT NULL,
  last_reviewed_at timestamptz,
  review_count integer NOT NULL DEFAULT 0,
  decay_score numeric NOT NULL DEFAULT 0 CHECK (decay_score >= 0 AND decay_score <= 100),
  next_review_due timestamptz,
  spaced_priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','due','overdue','satisfied','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, curriculum_id, competency_id)
);

ALTER TABLE public.revision_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full revision_cycles" ON public.revision_cycles
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "learner own revision_cycles" ON public.revision_cycles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin select revision_cycles" ON public.revision_cycles
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_revision_due
  ON public.revision_cycles(user_id, curriculum_id, next_review_due) WHERE status IN ('scheduled','due','overdue');

-- 4. Views (service_role only)
CREATE OR REPLACE VIEW public.v_exam_countdown_risk AS
SELECT
  ews.user_id, ews.curriculum_id, ews.exam_date, ews.days_to_exam,
  ews.phase, ews.recommended_focus, ews.intensity_recommendation,
  ews.signals
FROM public.exam_window_states ews
WHERE ews.exam_date IS NOT NULL
  AND ews.days_to_exam IS NOT NULL
  AND ews.days_to_exam <= 14;

CREATE OR REPLACE VIEW public.v_revision_decay_patterns AS
SELECT
  user_id, curriculum_id,
  COUNT(*)::int AS tracked_competencies,
  COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue,
  COUNT(*) FILTER (WHERE status = 'due')::int AS due_now,
  COUNT(*) FILTER (WHERE next_review_due BETWEEN now() AND now() + interval '3 days')::int AS due_soon,
  AVG(decay_score)::numeric(5,2) AS avg_decay,
  MAX(decay_score)::numeric(5,2) AS max_decay
FROM public.revision_cycles
WHERE status <> 'retired'
GROUP BY user_id, curriculum_id;

CREATE OR REPLACE VIEW public.v_time_pressure_effects AS
SELECT
  user_id, curriculum_id,
  COUNT(*) FILTER (WHERE days_to_exam_at_window <= 14)::int AS late_phase_windows,
  AVG(intensity_index) FILTER (WHERE days_to_exam_at_window <= 14)::numeric(5,2) AS late_intensity_avg,
  AVG(intensity_index) FILTER (WHERE days_to_exam_at_window > 14)::numeric(5,2) AS early_intensity_avg,
  SUM(new_lf_started) FILTER (WHERE days_to_exam_at_window <= 7)::int AS new_lf_in_final_week
FROM public.temporal_learning_patterns
WHERE days_to_exam_at_window IS NOT NULL
GROUP BY user_id, curriculum_id;

REVOKE ALL ON public.v_exam_countdown_risk FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_revision_decay_patterns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_time_pressure_effects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_exam_countdown_risk TO service_role;
GRANT SELECT ON public.v_revision_decay_patterns TO service_role;
GRANT SELECT ON public.v_time_pressure_effects TO service_role;

-- 5. Recompute function
CREATE OR REPLACE FUNCTION public.fn_recompute_exam_window_state(
  p_user_id uuid, p_curriculum_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_date date;
  v_days int;
  v_phase text := 'unscheduled';
  v_focus text := 'foundation';
  v_intensity text := 'normal';
  v_overdue int := 0;
  v_avg_decay numeric := 0;
  v_signals jsonb;
BEGIN
  SELECT exam_date INTO v_exam_date
  FROM public.exam_window_states
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  IF v_exam_date IS NOT NULL THEN
    v_days := (v_exam_date - CURRENT_DATE);
  END IF;

  SELECT COALESCE(COUNT(*) FILTER (WHERE status = 'overdue'),0),
         COALESCE(AVG(decay_score),0)
    INTO v_overdue, v_avg_decay
  FROM public.revision_cycles
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id AND status <> 'retired';

  IF v_days IS NULL THEN
    v_phase := 'unscheduled'; v_focus := 'foundation'; v_intensity := 'normal';
  ELSIF v_days < 0 THEN
    v_phase := 'post'; v_focus := 'retro'; v_intensity := 'low';
  ELSIF v_days <= 2 THEN
    v_phase := 'final'; v_focus := 'rest'; v_intensity := 'wind_down';
  ELSIF v_days <= 7 THEN
    v_phase := 'taper'; v_focus := 'review_only'; v_intensity := 'elevated';
  ELSIF v_days <= 21 THEN
    v_phase := 'sharpen'; v_focus := 'simulation'; v_intensity := 'peak';
  ELSIF v_days <= 60 THEN
    v_phase := 'build'; v_focus := 'depth'; v_intensity := 'elevated';
  ELSE
    v_phase := 'early'; v_focus := 'breadth'; v_intensity := 'normal';
  END IF;

  v_signals := jsonb_build_object(
    'days_to_exam', v_days,
    'overdue_reviews', v_overdue,
    'avg_decay', v_avg_decay,
    'high_decay_warning', (v_avg_decay >= 50),
    'late_phase', (v_days IS NOT NULL AND v_days <= 14)
  );

  INSERT INTO public.exam_window_states
    (user_id, curriculum_id, exam_date, days_to_exam, phase, recommended_focus,
     intensity_recommendation, signals, computed_at, updated_at)
  VALUES (p_user_id, p_curriculum_id, v_exam_date, v_days, v_phase, v_focus,
          v_intensity, v_signals, now(), now())
  ON CONFLICT (user_id, curriculum_id) DO UPDATE
    SET days_to_exam = EXCLUDED.days_to_exam,
        phase = EXCLUDED.phase,
        recommended_focus = EXCLUDED.recommended_focus,
        intensity_recommendation = EXCLUDED.intensity_recommendation,
        signals = EXCLUDED.signals,
        computed_at = now(),
        updated_at = now();

  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES ('exam_window_state_recomputed','learner','ok',
      jsonb_build_object('user_id',p_user_id,'curriculum_id',p_curriculum_id,
        'phase',v_phase,'days_to_exam',v_days,'focus',v_focus));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'phase', v_phase,
    'days_to_exam', v_days,
    'recommended_focus', v_focus,
    'intensity_recommendation', v_intensity,
    'signals', v_signals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recompute_exam_window_state(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recompute_exam_window_state(uuid,uuid) TO service_role;

-- 6. Admin summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_temporal_intelligence_health()
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
    'phase_counts', (
      SELECT jsonb_object_agg(phase, c) FROM (
        SELECT phase, COUNT(*)::int AS c
        FROM public.exam_window_states
        GROUP BY phase
      ) s
    ),
    'focus_counts', (
      SELECT jsonb_object_agg(recommended_focus, c) FROM (
        SELECT recommended_focus, COUNT(*)::int AS c
        FROM public.exam_window_states
        GROUP BY recommended_focus
      ) s
    ),
    'countdown_risk_total', (SELECT COUNT(*)::int FROM public.v_exam_countdown_risk),
    'final_week_learners', (SELECT COUNT(*)::int FROM public.exam_window_states WHERE days_to_exam BETWEEN 0 AND 7),
    'late_new_lf_count', (SELECT COALESCE(SUM(new_lf_in_final_week),0)::int FROM public.v_time_pressure_effects),
    'overdue_reviews_total', (SELECT COALESCE(SUM(overdue),0)::int FROM public.v_revision_decay_patterns),
    'avg_decay', (SELECT COALESCE(ROUND(AVG(avg_decay)::numeric,1),0) FROM public.v_revision_decay_patterns),
    'learners_with_exam_date', (SELECT COUNT(*)::int FROM public.exam_window_states WHERE exam_date IS NOT NULL),
    'computed_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_temporal_intelligence_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_temporal_intelligence_health() TO authenticated;
