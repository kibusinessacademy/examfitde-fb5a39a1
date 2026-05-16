
-- ═══════════════════════════════════════════════════════════════
-- BRIDGE 1: DELIVERED → ACTIVATED ORCHESTRATOR (P0)
-- ═══════════════════════════════════════════════════════════════

-- 1. Register job types
INSERT INTO public.ops_job_type_registry (job_type, pool, lane, requires_package_id, is_governance, is_active, description)
VALUES
  ('activation_welcome_sequence_enqueue', 'core', 'learner', false, false, true, 'Enqueue welcome email sequence on first entitlement'),
  ('activation_goal_capture_prompt',      'core', 'learner', false, false, true, 'Mark learner_profile.goal_capture_pending'),
  ('activation_exam_date_capture_prompt', 'core', 'learner', false, false, true, 'Mark learner_profile.exam_date_capture_pending'),
  ('activation_study_plan_generate',      'core', 'learner', false, false, true, 'Generate initial study plan from mastery + exam date'),
  ('activation_streak_initialize',        'core', 'learner', false, false, true, 'Initialize learner streak row'),
  ('activation_first_minicheck_seed',     'core', 'learner', false, false, true, 'Seed easiest LF1 minicheck into next_best_step')
ON CONFLICT (job_type) DO UPDATE
  SET lane = EXCLUDED.lane,
      pool = EXCLUDED.pool,
      is_active = true,
      description = EXCLUDED.description,
      updated_at = now();

-- 2. Soft columns on learner_profiles (idempotent additions)
ALTER TABLE public.learner_profiles
  ADD COLUMN IF NOT EXISTS goal_capture_pending boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS exam_date_capture_pending boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_activation_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_fanout_completed_at timestamptz;

-- 3. Orchestrator: fan out activation jobs (idempotent per grant via idempotency_key)
CREATE OR REPLACE FUNCTION public.fn_learner_activation_fanout(
  p_grant_id uuid,
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobs text[] := ARRAY[
    'activation_welcome_sequence_enqueue',
    'activation_goal_capture_prompt',
    'activation_exam_date_capture_prompt',
    'activation_study_plan_generate',
    'activation_streak_initialize',
    'activation_first_minicheck_seed'
  ];
  v_jt text;
  v_correlation uuid := gen_random_uuid();
  v_enqueued int := 0;
  v_skipped int := 0;
  v_idem text;
BEGIN
  FOREACH v_jt IN ARRAY v_jobs LOOP
    v_idem := 'learner_activation|' || p_grant_id::text || '|' || v_jt;
    BEGIN
      INSERT INTO public.job_queue (
        job_type, job_name, status, payload, priority, run_after,
        worker_pool, lane, idempotency_key, correlation_id, root_job_id, meta
      ) VALUES (
        v_jt, v_jt, 'pending',
        jsonb_build_object(
          'grant_id', p_grant_id,
          'user_id', p_user_id,
          'curriculum_id', p_curriculum_id,
          '_origin', 'learner_activation_fanout'
        ),
        5, now(), 'core', 'learner', v_idem, v_correlation, v_correlation,
        jsonb_build_object('source', 'learner_activation_fanout')
      );
      v_enqueued := v_enqueued + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  -- Mark fanout complete on profile (best-effort)
  UPDATE public.learner_profiles
     SET first_activation_at = COALESCE(first_activation_at, now()),
         activation_fanout_completed_at = now()
   WHERE user_id = p_user_id;

  -- Audit
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'learner_activation_fanout',
    'learner_grant',
    p_grant_id::text,
    'ok',
    jsonb_build_object(
      'user_id', p_user_id,
      'curriculum_id', p_curriculum_id,
      'enqueued', v_enqueued,
      'skipped', v_skipped,
      'correlation_id', v_correlation
    )
  );

  RETURN jsonb_build_object(
    'enqueued', v_enqueued,
    'skipped', v_skipped,
    'correlation_id', v_correlation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_learner_activation_fanout(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_learner_activation_fanout(uuid, uuid, uuid) TO service_role;

-- 4. Trigger on learner_course_grants: fire on first activation per (user, curriculum)
CREATE OR REPLACE FUNCTION public.trg_fn_learner_grant_activation_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire on first transition to "activated" (activated_at set + status active)
  IF NEW.activated_at IS NOT NULL
     AND COALESCE(OLD.activated_at, NULL) IS NULL
     AND COALESCE(NEW.status, '') IN ('active', 'granted', 'paid') THEN
    PERFORM public.fn_learner_activation_fanout(NEW.id, NEW.user_id, NEW.curriculum_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_learner_grant_activation_fanout ON public.learner_course_grants;
CREATE TRIGGER trg_learner_grant_activation_fanout
AFTER INSERT OR UPDATE OF activated_at ON public.learner_course_grants
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_learner_grant_activation_fanout();

-- 5. SSOT View: v_learner_activation_state
CREATE OR REPLACE VIEW public.v_learner_activation_state AS
SELECT
  g.user_id,
  g.curriculum_id,
  g.id AS grant_id,
  g.activated_at,
  g.granted_at,
  COALESCE(lp.last_activity_at, g.activated_at) AS last_activity_at,
  COALESCE(lp.streak_current, 0) AS streak_current,
  COALESCE(lp.activation_fanout_completed_at, NULL) AS fanout_completed_at,
  (SELECT COUNT(*) FROM public.learner_competency_state lcs
    WHERE lcs.user_id = g.user_id AND lcs.samples_total > 0) AS minichecks_with_samples,
  CASE
    WHEN g.activated_at IS NULL THEN 'NOT_STARTED'
    WHEN lp.activation_fanout_completed_at IS NULL THEN 'ONBOARDING'
    WHEN COALESCE(lp.last_activity_at, g.activated_at) < now() - interval '30 days' THEN 'DORMANT'
    WHEN COALESCE(lp.last_activity_at, g.activated_at) < now() - interval '14 days' THEN 'AT_RISK'
    WHEN COALESCE(lp.streak_current, 0) >= 3
      OR (SELECT COUNT(*) FROM public.learner_competency_state lcs
           WHERE lcs.user_id = g.user_id AND lcs.samples_total > 0) >= 5
      THEN 'ENGAGED'
    ELSE 'ACTIVATED'
  END AS activation_state
FROM public.learner_course_grants g
LEFT JOIN public.learner_profiles lp ON lp.user_id = g.user_id
WHERE g.status IN ('active', 'granted', 'paid');

REVOKE ALL ON public.v_learner_activation_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_learner_activation_state TO service_role;

-- 6. SLA-breach detector: fanout must complete within 10 minutes of activation
CREATE OR REPLACE FUNCTION public.fn_detect_activation_sla_breach(p_minutes int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_breached_count int := 0;
  v_repaired_count int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT g.id AS grant_id, g.user_id, g.curriculum_id, g.activated_at
      FROM public.learner_course_grants g
      LEFT JOIN public.learner_profiles lp ON lp.user_id = g.user_id
     WHERE g.activated_at IS NOT NULL
       AND g.status IN ('active', 'granted', 'paid')
       AND g.activated_at < now() - make_interval(mins => p_minutes)
       AND COALESCE(lp.activation_fanout_completed_at, 'epoch'::timestamptz) < g.activated_at
     LIMIT 100
  LOOP
    v_breached_count := v_breached_count + 1;
    BEGIN
      PERFORM public.fn_learner_activation_fanout(r.grant_id, r.user_id, r.curriculum_id);
      v_repaired_count := v_repaired_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, error_message)
      VALUES ('activation_sla_breach', 'learner_grant', r.grant_id::text, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'activation_sla_check',
    'system',
    CASE WHEN v_breached_count > 0 THEN 'repaired' ELSE 'ok' END,
    jsonb_build_object('breached', v_breached_count, 'repaired', v_repaired_count, 'sla_minutes', p_minutes)
  );

  RETURN jsonb_build_object('breached', v_breached_count, 'repaired', v_repaired_count);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_activation_sla_breach(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_activation_sla_breach(int) TO service_role;

-- 7. Admin RPC: activation funnel summary
CREATE OR REPLACE FUNCTION public.admin_get_activation_funnel()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_dormant jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_object_agg(activation_state, cnt) INTO v_summary
  FROM (
    SELECT activation_state, COUNT(*) AS cnt
      FROM public.v_learner_activation_state
     GROUP BY activation_state
  ) s;

  SELECT jsonb_agg(row_to_json(d)) INTO v_dormant FROM (
    SELECT user_id, curriculum_id, grant_id, activation_state, last_activity_at, streak_current
      FROM public.v_learner_activation_state
     WHERE activation_state IN ('DORMANT', 'AT_RISK')
     ORDER BY last_activity_at NULLS FIRST
     LIMIT 50
  ) d;

  RETURN jsonb_build_object(
    'summary', COALESCE(v_summary, '{}'::jsonb),
    'rescue_candidates', COALESCE(v_dormant, '[]'::jsonb),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_activation_funnel() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_activation_funnel() TO authenticated, service_role;

-- Smoke audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('learner_activation_orchestrator_install', 'system', 'ok',
        jsonb_build_object('bridge', 'delivered_to_activated_v1', 'installed_at', now()));
