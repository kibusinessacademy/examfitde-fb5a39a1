
-- ============================================================
-- Bridge 4: Intervention Intelligence / Next-Best-Action Engine
-- ============================================================

-- 1. SSOT table: learner_intervention_state
CREATE TABLE IF NOT EXISTS public.learner_intervention_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  nba_action text NOT NULL,
  nba_priority integer NOT NULL DEFAULT 50,
  nba_reason_code text,
  nba_reason_text text,
  nba_target_type text,
  nba_target_id uuid,
  nba_route text,
  failure_risk_pct numeric,
  retention_risk text CHECK (retention_risk IN ('low','medium','high','critical')),
  exam_success_probability_pct numeric,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '6 hours'),
  dispatched_at timestamptz,
  dispatched_job_id uuid,
  UNIQUE(user_id, curriculum_id)
);

CREATE INDEX IF NOT EXISTS idx_lis_user_curr ON public.learner_intervention_state(user_id, curriculum_id);
CREATE INDEX IF NOT EXISTS idx_lis_priority ON public.learner_intervention_state(nba_priority DESC, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lis_retention_risk ON public.learner_intervention_state(retention_risk) WHERE retention_risk IN ('high','critical');
CREATE INDEX IF NOT EXISTS idx_lis_expires ON public.learner_intervention_state(expires_at);

ALTER TABLE public.learner_intervention_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "learner_intervention_state_owner_read"
  ON public.learner_intervention_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "learner_intervention_state_admin_read"
  ON public.learner_intervention_state FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "learner_intervention_state_service_all"
  ON public.learner_intervention_state FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2. Audit log: dispatched interventions
CREATE TABLE IF NOT EXISTS public.learner_intervention_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  intervention_type text NOT NULL,
  trigger_reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text,
  job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lidl_user_curr_created
  ON public.learner_intervention_dispatch_log(user_id, curriculum_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lidl_type_created
  ON public.learner_intervention_dispatch_log(intervention_type, created_at DESC);

ALTER TABLE public.learner_intervention_dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lidl_admin_read"
  ON public.learner_intervention_dispatch_log FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "lidl_service_all"
  ON public.learner_intervention_dispatch_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. Register new job types
INSERT INTO public.ops_job_type_registry (job_type, job_name, pool, lane, is_governance, requires_package_id, is_active, description)
VALUES
  ('compute_next_best_action','compute_next_best_action','default','control', false, false, true,
    'Bridge 4: recompute learner_intervention_state for one (user,curriculum)'),
  ('trigger_learning_intervention','trigger_learning_intervention','default','control', false, false, true,
    'Bridge 4: dispatch a learning intervention (weakness drill, tutor hint, simulation seed)'),
  ('trigger_retention_intervention','trigger_retention_intervention','default','control', false, false, true,
    'Bridge 4: dispatch retention nudge (email_delivery_queue) for at-risk/dormant learners'),
  ('generate_manager_alert','generate_manager_alert','default','control', false, false, true,
    'Bridge 4: emit B2B manager/Ausbilder alert when learner failure risk is HIGH'),
  ('schedule_exam_simulation','schedule_exam_simulation','default','control', false, false, true,
    'Bridge 4: schedule/pre-warm an exam simulation when readiness needs hardening')
ON CONFLICT (job_type) DO UPDATE SET
  is_active = true,
  description = EXCLUDED.description,
  updated_at = now();

-- 4. View: v_retention_risk
CREATE OR REPLACE VIEW public.v_retention_risk AS
SELECT
  lp.user_id,
  lcg.curriculum_id,
  lp.last_activity_at,
  COALESCE(EXTRACT(EPOCH FROM (now() - lp.last_activity_at))/86400.0, 999)::numeric AS days_since_activity,
  lp.streak_current,
  lp.consistency_7d,
  COALESCE(lp.churn_risk_score, 0)::numeric AS churn_risk_score,
  CASE
    WHEN lp.last_activity_at IS NULL THEN 'high'
    WHEN now() - lp.last_activity_at > interval '30 days' THEN 'critical'
    WHEN now() - lp.last_activity_at > interval '14 days' THEN 'high'
    WHEN now() - lp.last_activity_at > interval '7 days' THEN 'medium'
    ELSE 'low'
  END AS retention_risk
FROM public.learner_profiles lp
JOIN public.learner_course_grants lcg ON lcg.user_id = lp.user_id AND lcg.status = 'active';

-- 5. View: v_exam_success_probability (uses latest readiness snapshot)
CREATE OR REPLACE VIEW public.v_exam_success_probability AS
WITH latest AS (
  SELECT DISTINCT ON (user_id, curriculum_id)
    user_id, curriculum_id, readiness_score, verdict,
    coverage_pct, confidence_pct, stability_pct, simulation_pct,
    lf_gap_count, weak_competency_count, days_to_exam, computed_at
  FROM public.learner_readiness_history
  ORDER BY user_id, curriculum_id, computed_at DESC
)
SELECT
  l.user_id,
  l.curriculum_id,
  l.readiness_score,
  l.verdict,
  l.days_to_exam,
  -- Probability heuristic: readiness * stability bias, dampened by lf_gaps and time pressure
  GREATEST(0, LEAST(100,
    (COALESCE(l.readiness_score, 0) * 0.6)
    + (COALESCE(l.stability_pct, 0) * 0.2)
    + (COALESCE(l.coverage_pct, 0) * 0.2)
    - (COALESCE(l.lf_gap_count, 0) * 3)
    - CASE
        WHEN l.days_to_exam IS NULL THEN 0
        WHEN l.days_to_exam <= 7 AND COALESCE(l.readiness_score,0) < 70 THEN 15
        WHEN l.days_to_exam <= 14 AND COALESCE(l.readiness_score,0) < 70 THEN 8
        ELSE 0
      END
  ))::numeric AS exam_success_probability_pct,
  l.computed_at
FROM latest l;

-- 6. View: v_next_best_action — synthesizes the recommended action per learner
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH readiness AS (
  SELECT DISTINCT ON (user_id, curriculum_id)
    user_id, curriculum_id, readiness_score, verdict,
    coverage_pct, simulation_pct, lf_gap_count, weak_competency_count,
    days_to_exam, computed_at
  FROM public.learner_readiness_history
  ORDER BY user_id, curriculum_id, computed_at DESC
),
weakest_comp AS (
  SELECT DISTINCT ON (user_id, curriculum_id)
    user_id, curriculum_id, competency_id, mastery_score
  FROM public.user_competency_mastery
  WHERE mastery_state IN ('weak','struggling') OR COALESCE(mastery_score,0) < 50
  ORDER BY user_id, curriculum_id, mastery_score ASC NULLS FIRST
),
retention AS (
  SELECT user_id, curriculum_id, retention_risk, days_since_activity
  FROM public.v_retention_risk
),
prob AS (
  SELECT user_id, curriculum_id, exam_success_probability_pct
  FROM public.v_exam_success_probability
)
SELECT
  lcg.user_id,
  lcg.curriculum_id,
  COALESCE(r.verdict, 'NOT_STARTED') AS readiness_verdict,
  COALESCE(r.readiness_score, 0)::numeric AS readiness_score,
  COALESCE(p.exam_success_probability_pct, 0)::numeric AS exam_success_probability_pct,
  COALESCE(ret.retention_risk, 'high') AS retention_risk,
  ret.days_since_activity,
  wc.competency_id AS weakest_competency_id,
  r.lf_gap_count,
  r.days_to_exam,
  -- Decision tree → action
  CASE
    WHEN lcg.activated_at IS NULL THEN 'activate_account'
    WHEN ret.retention_risk = 'critical' THEN 'winback_campaign'
    WHEN ret.retention_risk = 'high' THEN 'retention_nudge'
    WHEN r.verdict = 'CRITICAL' THEN 'rescue_session'
    WHEN r.verdict = 'AT_RISK' AND r.lf_gap_count > 0 THEN 'lf_gap_drill'
    WHEN r.verdict = 'AT_RISK' THEN 'weakness_training'
    WHEN r.verdict = 'PARTIAL' AND r.days_to_exam IS NOT NULL AND r.days_to_exam <= 14
      THEN 'exam_simulation'
    WHEN r.verdict = 'PARTIAL' THEN 'weakness_training'
    WHEN r.verdict = 'READY' AND r.days_to_exam IS NOT NULL AND r.days_to_exam <= 7
      THEN 'final_exam_prep'
    WHEN r.verdict = 'READY' THEN 'maintain_streak'
    ELSE 'continue_learning'
  END AS nba_action,
  -- Priority 0-100 (higher = more urgent)
  CASE
    WHEN ret.retention_risk = 'critical' THEN 95
    WHEN r.verdict = 'CRITICAL' THEN 90
    WHEN ret.retention_risk = 'high' THEN 80
    WHEN r.verdict = 'AT_RISK' THEN 75
    WHEN r.verdict = 'PARTIAL' AND r.days_to_exam IS NOT NULL AND r.days_to_exam <= 14 THEN 70
    WHEN lcg.activated_at IS NULL THEN 65
    WHEN r.verdict = 'PARTIAL' THEN 55
    WHEN r.verdict = 'READY' THEN 30
    ELSE 50
  END AS nba_priority
FROM public.learner_course_grants lcg
LEFT JOIN readiness r ON r.user_id = lcg.user_id AND r.curriculum_id = lcg.curriculum_id
LEFT JOIN weakest_comp wc ON wc.user_id = lcg.user_id AND wc.curriculum_id = lcg.curriculum_id
LEFT JOIN retention ret ON ret.user_id = lcg.user_id AND ret.curriculum_id = lcg.curriculum_id
LEFT JOIN prob p ON p.user_id = lcg.user_id AND p.curriculum_id = lcg.curriculum_id
WHERE lcg.status = 'active';

-- Lock views from anon/auth (admin only via RPC)
REVOKE ALL ON public.v_next_best_action FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_retention_risk FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_exam_success_probability FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_next_best_action TO service_role;
GRANT SELECT ON public.v_retention_risk TO service_role;
GRANT SELECT ON public.v_exam_success_probability TO service_role;

-- 7. RPC: fn_compute_next_best_action (writes into learner_intervention_state)
CREATE OR REPLACE FUNCTION public.fn_compute_next_best_action(
  p_user_id uuid,
  p_curriculum_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_state_id uuid;
  v_route text;
  v_reason_text text;
BEGIN
  SELECT * INTO v_row FROM public.v_next_best_action
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_route := CASE v_row.nba_action
    WHEN 'activate_account' THEN '/onboarding'
    WHEN 'winback_campaign' THEN '/dashboard'
    WHEN 'retention_nudge' THEN '/dashboard'
    WHEN 'rescue_session' THEN '/exam-trainer?intent=rescue'
    WHEN 'lf_gap_drill' THEN '/exam-trainer?intent=lf_gap'
    WHEN 'weakness_training' THEN '/exam-trainer?intent=weakness'
    WHEN 'exam_simulation' THEN '/exam-simulation'
    WHEN 'final_exam_prep' THEN '/exam-simulation?intent=final'
    WHEN 'maintain_streak' THEN '/dashboard'
    ELSE '/dashboard'
  END;

  v_reason_text := format(
    'Readiness=%s (%s%%), Retention=%s, ExamSuccessP=%s%%, LFGaps=%s, DaysToExam=%s',
    COALESCE(v_row.readiness_verdict,'-'),
    ROUND(COALESCE(v_row.readiness_score,0)),
    COALESCE(v_row.retention_risk,'-'),
    ROUND(COALESCE(v_row.exam_success_probability_pct,0)),
    COALESCE(v_row.lf_gap_count,0),
    COALESCE(v_row.days_to_exam::text,'n/a')
  );

  INSERT INTO public.learner_intervention_state AS lis (
    user_id, curriculum_id, nba_action, nba_priority,
    nba_reason_code, nba_reason_text, nba_target_type, nba_target_id, nba_route,
    failure_risk_pct, retention_risk, exam_success_probability_pct,
    inputs, computed_at, expires_at, dispatched_at, dispatched_job_id
  ) VALUES (
    p_user_id, p_curriculum_id, v_row.nba_action, v_row.nba_priority,
    'auto_v1', v_reason_text,
    CASE WHEN v_row.weakest_competency_id IS NOT NULL THEN 'competency' ELSE NULL END,
    v_row.weakest_competency_id,
    v_route,
    GREATEST(0, 100 - COALESCE(v_row.exam_success_probability_pct, 0))::numeric,
    v_row.retention_risk,
    v_row.exam_success_probability_pct,
    to_jsonb(v_row),
    now(), now() + interval '6 hours', NULL, NULL
  )
  ON CONFLICT (user_id, curriculum_id) DO UPDATE SET
    nba_action = EXCLUDED.nba_action,
    nba_priority = EXCLUDED.nba_priority,
    nba_reason_code = EXCLUDED.nba_reason_code,
    nba_reason_text = EXCLUDED.nba_reason_text,
    nba_target_type = EXCLUDED.nba_target_type,
    nba_target_id = EXCLUDED.nba_target_id,
    nba_route = EXCLUDED.nba_route,
    failure_risk_pct = EXCLUDED.failure_risk_pct,
    retention_risk = EXCLUDED.retention_risk,
    exam_success_probability_pct = EXCLUDED.exam_success_probability_pct,
    inputs = EXCLUDED.inputs,
    computed_at = EXCLUDED.computed_at,
    expires_at = EXCLUDED.expires_at,
    dispatched_at = NULL,
    dispatched_job_id = NULL
  RETURNING id INTO v_state_id;

  RETURN v_state_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_compute_next_best_action(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_next_best_action(uuid, uuid) TO service_role;

-- 8. Admin RPC: distribution summary for cockpit
CREATE OR REPLACE FUNCTION public.admin_get_intervention_distribution()
RETURNS TABLE(
  nba_action text,
  retention_risk text,
  learner_count bigint,
  avg_priority numeric,
  avg_failure_risk numeric,
  avg_exam_success_prob numeric,
  pending_dispatch_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  RETURN QUERY
  SELECT
    lis.nba_action,
    COALESCE(lis.retention_risk, 'unknown') AS retention_risk,
    COUNT(*)::bigint AS learner_count,
    ROUND(AVG(lis.nba_priority)::numeric, 1) AS avg_priority,
    ROUND(AVG(lis.failure_risk_pct)::numeric, 1) AS avg_failure_risk,
    ROUND(AVG(lis.exam_success_probability_pct)::numeric, 1) AS avg_exam_success_prob,
    COUNT(*) FILTER (WHERE lis.dispatched_at IS NULL AND lis.nba_priority >= 70)::bigint AS pending_dispatch_count
  FROM public.learner_intervention_state lis
  GROUP BY lis.nba_action, COALESCE(lis.retention_risk, 'unknown')
  ORDER BY learner_count DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_intervention_distribution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_intervention_distribution() TO authenticated;

-- 9. Trigger: readiness change → enqueue compute_next_best_action
CREATE OR REPLACE FUNCTION public.fn_enqueue_nba_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idem text;
BEGIN
  v_idem := 'nba_recompute|' || NEW.user_id::text || '|' || NEW.curriculum_id::text
            || '|' || to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI');

  INSERT INTO public.job_queue (
    job_type, job_name, status, priority, payload, idempotency_key,
    correlation_id, run_after
  ) VALUES (
    'compute_next_best_action',
    'compute_next_best_action',
    'pending',
    20,
    jsonb_build_object(
      'user_id', NEW.user_id,
      'curriculum_id', NEW.curriculum_id,
      'trigger', 'readiness_change',
      'readiness_verdict', NEW.verdict
    ),
    v_idem,
    gen_random_uuid(),
    now() + interval '15 seconds'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_readiness_to_nba ON public.learner_readiness_history;
CREATE TRIGGER trg_readiness_to_nba
AFTER INSERT ON public.learner_readiness_history
FOR EACH ROW EXECUTE FUNCTION public.fn_enqueue_nba_recompute();

-- 10. SLA detector: states with priority>=70 not dispatched within 30min
CREATE OR REPLACE FUNCTION public.fn_detect_intervention_sla_breach(p_threshold_minutes int DEFAULT 30)
RETURNS TABLE(
  user_id uuid,
  curriculum_id uuid,
  nba_action text,
  nba_priority int,
  retention_risk text,
  computed_at timestamptz,
  minutes_stale int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lis.user_id, lis.curriculum_id, lis.nba_action, lis.nba_priority,
    lis.retention_risk, lis.computed_at,
    EXTRACT(EPOCH FROM (now() - lis.computed_at))::int / 60 AS minutes_stale
  FROM public.learner_intervention_state lis
  WHERE lis.nba_priority >= 70
    AND lis.dispatched_at IS NULL
    AND lis.computed_at < now() - make_interval(mins => p_threshold_minutes);

  -- audit
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'intervention_sla_check',
    'system',
    'completed',
    jsonb_build_object('threshold_minutes', p_threshold_minutes, 'checked_at', now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_intervention_sla_breach(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_intervention_sla_breach(int) TO service_role;
