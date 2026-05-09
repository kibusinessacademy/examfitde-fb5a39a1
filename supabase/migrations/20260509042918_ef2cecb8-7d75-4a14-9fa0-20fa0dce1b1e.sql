-- S3 Migration 1: Mastery v2 — Config + Bridge RPCs + Simulator + next_best_step payload + minicheck bridge
-- Concern: Mastery domain consolidation (Track A + Track D)

-- ================================================================
-- 1) Config table (singleton) — NO INSERT/UPDATE/DELETE policies, only admin RPC writes
-- ================================================================
CREATE TABLE IF NOT EXISTS public.mastery_engine_config (
  id text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  decay_tau_days numeric NOT NULL DEFAULT 14 CHECK (decay_tau_days > 0 AND decay_tau_days <= 365),
  ewma_alpha numeric NOT NULL DEFAULT 0.30 CHECK (ewma_alpha > 0 AND ewma_alpha <= 1),
  confidence_sample_anchor numeric NOT NULL DEFAULT 8.0 CHECK (confidence_sample_anchor > 0),
  repair_threshold numeric NOT NULL DEFAULT 60 CHECK (repair_threshold >= 0 AND repair_threshold <= 100),
  drill_threshold numeric NOT NULL DEFAULT 80 CHECK (drill_threshold > 0 AND drill_threshold <= 100),
  reinforce_threshold numeric NOT NULL DEFAULT 90 CHECK (reinforce_threshold > 0 AND reinforce_threshold <= 100),
  decay_alert_threshold numeric NOT NULL DEFAULT 50 CHECK (decay_alert_threshold >= 0 AND decay_alert_threshold <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK (repair_threshold < drill_threshold AND drill_threshold < reinforce_threshold)
);

ALTER TABLE public.mastery_engine_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read mastery config" ON public.mastery_engine_config;
CREATE POLICY "Admins can read mastery config" ON public.mastery_engine_config
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Seed singleton
INSERT INTO public.mastery_engine_config (id) VALUES ('singleton') ON CONFLICT DO NOTHING;

-- ================================================================
-- 2) Config helper (STABLE, read by mastery functions)
-- ================================================================
CREATE OR REPLACE FUNCTION public.fn_get_mastery_config()
RETURNS TABLE(
  decay_tau_days numeric, ewma_alpha numeric, confidence_sample_anchor numeric,
  repair_threshold numeric, drill_threshold numeric, reinforce_threshold numeric,
  decay_alert_threshold numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(c.decay_tau_days, 14),
    COALESCE(c.ewma_alpha, 0.30),
    COALESCE(c.confidence_sample_anchor, 8.0),
    COALESCE(c.repair_threshold, 60),
    COALESCE(c.drill_threshold, 80),
    COALESCE(c.reinforce_threshold, 90),
    COALESCE(c.decay_alert_threshold, 50)
  FROM (SELECT 1) z
  LEFT JOIN public.mastery_engine_config c ON c.id = 'singleton';
$$;

-- ================================================================
-- 3) Recreate update_mastery_from_attempt to read config
-- ================================================================
CREATE OR REPLACE FUNCTION public.update_mastery_from_attempt(
  p_user_id uuid, p_course_id uuid, p_competency_id uuid, p_correct boolean,
  p_response_ms integer DEFAULT NULL, p_event_type text DEFAULT 'quiz',
  p_question_id uuid DEFAULT NULL, p_misconception_tags jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  v_state public.learner_competency_state%ROWTYPE;
  v_mastery_before numeric; v_mastery_after numeric;
  v_confidence numeric; v_decay numeric; v_readiness numeric;
  v_days numeric; v_new_avg_ms numeric;
  v_existing_pattern jsonb; v_recurring jsonb; v_misconceptions jsonb;
  v_cfg record;
BEGIN
  IF p_user_id IS NULL OR p_course_id IS NULL OR p_competency_id IS NULL THEN
    RAISE EXCEPTION 'user_id, course_id, competency_id required';
  END IF;
  IF v_caller_role <> 'service_role' AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'cannot update mastery for another user';
  END IF;

  SELECT * INTO v_cfg FROM public.fn_get_mastery_config();

  SELECT * INTO v_state FROM public.learner_competency_state
   WHERE user_id=p_user_id AND course_id=p_course_id AND competency_id=p_competency_id FOR UPDATE;

  v_mastery_before := COALESCE(v_state.mastery_score, 0);
  v_mastery_after := v_mastery_before + v_cfg.ewma_alpha * ((CASE WHEN p_correct THEN 100 ELSE 0 END) - v_mastery_before);
  v_days := COALESCE(EXTRACT(EPOCH FROM (now() - COALESCE(v_state.last_practice_at, now())))/86400.0, 0);
  v_decay := LEAST(100, GREATEST(0, 100 * exp(- v_days / v_cfg.decay_tau_days)));
  v_confidence := 100 * (1 - exp(- (COALESCE(v_state.samples_total,0) + 1) / v_cfg.confidence_sample_anchor));
  v_readiness := v_mastery_after * (v_confidence/100.0) * (v_decay/100.0);

  v_existing_pattern := COALESCE(v_state.error_pattern, jsonb_build_object(
    'misconception_tags','[]'::jsonb, 'recurring_question_ids','[]'::jsonb,
    'avg_response_ms',0, 'hint_usage_rate',0));

  v_new_avg_ms := CASE
    WHEN p_response_ms IS NULL THEN COALESCE((v_existing_pattern->>'avg_response_ms')::numeric,0)
    WHEN COALESCE(v_state.samples_total,0) = 0 THEN p_response_ms::numeric
    ELSE ((COALESCE((v_existing_pattern->>'avg_response_ms')::numeric,0) * v_state.samples_total) + p_response_ms) / (v_state.samples_total + 1)
  END;

  IF NOT p_correct AND p_question_id IS NOT NULL THEN
    v_recurring := COALESCE(v_existing_pattern->'recurring_question_ids', '[]'::jsonb) || jsonb_build_array(p_question_id);
    IF jsonb_array_length(v_recurring) > 50 THEN
      v_recurring := (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(v_recurring) x ORDER BY 1 DESC LIMIT 50) s);
    END IF;
  ELSE
    v_recurring := COALESCE(v_existing_pattern->'recurring_question_ids', '[]'::jsonb);
  END IF;

  v_misconceptions := CASE
    WHEN NOT p_correct AND jsonb_array_length(COALESCE(p_misconception_tags,'[]'::jsonb)) > 0
      THEN COALESCE(v_existing_pattern->'misconception_tags','[]'::jsonb) || p_misconception_tags
    ELSE COALESCE(v_existing_pattern->'misconception_tags','[]'::jsonb)
  END;

  INSERT INTO public.learner_competency_state(
    user_id, course_id, competency_id, mastery_score, confidence, decay_score, exam_readiness,
    error_pattern, samples_total, samples_correct, last_practice_at, last_event_type, updated_at)
  VALUES (
    p_user_id, p_course_id, p_competency_id,
    ROUND(v_mastery_after::numeric,2), ROUND(v_confidence::numeric,2),
    ROUND(v_decay::numeric,2), ROUND(v_readiness::numeric,2),
    jsonb_build_object('misconception_tags', v_misconceptions, 'recurring_question_ids', v_recurring,
      'avg_response_ms', ROUND(v_new_avg_ms,0),
      'hint_usage_rate', COALESCE((v_existing_pattern->>'hint_usage_rate')::numeric,0)),
    1, CASE WHEN p_correct THEN 1 ELSE 0 END, now(), p_event_type, now())
  ON CONFLICT (user_id, course_id, competency_id) DO UPDATE SET
    mastery_score = EXCLUDED.mastery_score, confidence = EXCLUDED.confidence,
    decay_score = EXCLUDED.decay_score, exam_readiness = EXCLUDED.exam_readiness,
    error_pattern = EXCLUDED.error_pattern,
    samples_total = public.learner_competency_state.samples_total + 1,
    samples_correct = public.learner_competency_state.samples_correct + (CASE WHEN p_correct THEN 1 ELSE 0 END),
    last_practice_at = now(), last_event_type = EXCLUDED.last_event_type, updated_at = now();

  INSERT INTO public.learner_mastery_event_log(
    user_id, course_id, competency_id, event_type, is_correct, response_ms,
    question_id, misconception_tags, mastery_before, mastery_after, exam_readiness_after)
  VALUES (
    p_user_id, p_course_id, p_competency_id, p_event_type, p_correct, p_response_ms,
    p_question_id, p_misconception_tags,
    ROUND(v_mastery_before,2), ROUND(v_mastery_after,2), ROUND(v_readiness,2));

  RETURN jsonb_build_object(
    'mastery_before', ROUND(v_mastery_before,2),
    'mastery_after', ROUND(v_mastery_after,2),
    'confidence', ROUND(v_confidence,2),
    'decay_score', ROUND(v_decay,2),
    'exam_readiness', ROUND(v_readiness,2),
    'config_used', jsonb_build_object(
      'decay_tau_days', v_cfg.decay_tau_days, 'ewma_alpha', v_cfg.ewma_alpha,
      'confidence_sample_anchor', v_cfg.confidence_sample_anchor)
  );
END $function$;

-- ================================================================
-- 4) learner_next_best_step v2 — config thresholds + payload column
-- ================================================================
DROP FUNCTION IF EXISTS public.learner_next_best_step(uuid, integer);
CREATE OR REPLACE FUNCTION public.learner_next_best_step(p_course_id uuid, p_limit integer DEFAULT 5)
RETURNS TABLE(
  competency_id uuid, competency_title text, recommended_action text,
  exam_readiness numeric, mastery_score numeric, decay_score numeric,
  priority_score numeric, reason text, payload jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_cfg record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO v_cfg FROM public.fn_get_mastery_config();

  RETURN QUERY
    WITH base AS (
      SELECT s.competency_id, c.title AS competency_title,
             s.exam_readiness, s.mastery_score, s.decay_score, s.samples_total,
             s.last_practice_at, s.error_pattern
        FROM public.learner_competency_state s
        LEFT JOIN public.competencies c ON c.id = s.competency_id
       WHERE s.user_id = v_user AND s.course_id = p_course_id
    ),
    scored AS (
      SELECT b.*,
        CASE
          WHEN b.mastery_score < v_cfg.repair_threshold THEN 'REPAIR'
          WHEN b.mastery_score < v_cfg.drill_threshold THEN 'DRILL'
          WHEN b.mastery_score < v_cfg.reinforce_threshold THEN 'REINFORCE'
          ELSE 'CHALLENGE'
        END AS recommended_action_calc,
        ROUND((
          (100 - b.exam_readiness)
          + CASE WHEN b.decay_score < v_cfg.decay_alert_threshold THEN (v_cfg.decay_alert_threshold - b.decay_score) ELSE 0 END
          + CASE WHEN b.samples_total < 3 THEN 15 ELSE 0 END
        )::numeric, 2) AS priority_score_calc,
        CASE
          WHEN b.mastery_score < v_cfg.repair_threshold THEN 'low_mastery'
          WHEN b.decay_score < v_cfg.decay_alert_threshold THEN 'high_decay'
          WHEN b.samples_total < 3 THEN 'low_evidence'
          WHEN b.mastery_score < v_cfg.drill_threshold THEN 'consolidation_needed'
          ELSE 'enrichment'
        END AS reason_calc
      FROM base b
    )
    SELECT s.competency_id, s.competency_title, s.recommended_action_calc,
           s.exam_readiness, s.mastery_score, s.decay_score,
           s.priority_score_calc, s.reason_calc,
           jsonb_build_object(
             'days_since_practice', ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(s.last_practice_at, now())))/86400.0, 1),
             'samples_total', s.samples_total,
             'misconception_tags', COALESCE(s.error_pattern->'misconception_tags', '[]'::jsonb),
             'recurring_question_ids', COALESCE(s.error_pattern->'recurring_question_ids', '[]'::jsonb),
             'thresholds', jsonb_build_object(
               'repair', v_cfg.repair_threshold,
               'drill', v_cfg.drill_threshold,
               'reinforce', v_cfg.reinforce_threshold,
               'decay_alert', v_cfg.decay_alert_threshold)
           ) AS payload
      FROM scored s
     ORDER BY s.priority_score_calc DESC
     LIMIT GREATEST(LEAST(p_limit, 20), 1);
END $function$;

-- ================================================================
-- 5) Helper: resolve competency from question_id
-- ================================================================
CREATE OR REPLACE FUNCTION public._resolve_competency_for_question(p_question_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT competency_id FROM public.exam_questions WHERE id = p_question_id LIMIT 1;
$$;

-- ================================================================
-- 6) Bridge RPC: bulk attempt → mastery (Quiz/Exam/Tutor flows call this)
-- ================================================================
CREATE OR REPLACE FUNCTION public.record_attempt_mastery_bulk(
  p_user_id uuid, p_course_id uuid, p_event_type text, p_attempts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  v_attempt jsonb; v_competency uuid; v_question uuid; v_correct boolean;
  v_response_ms integer; v_misc jsonb;
  v_processed integer := 0; v_skipped integer := 0;
BEGIN
  IF v_caller_role <> 'service_role' AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'cannot record attempts for another user';
  END IF;
  IF p_event_type NOT IN ('quiz','minicheck','exam','tutor') THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type;
  END IF;
  IF jsonb_typeof(p_attempts) <> 'array' THEN
    RAISE EXCEPTION 'p_attempts must be jsonb array';
  END IF;

  FOR v_attempt IN SELECT * FROM jsonb_array_elements(p_attempts) LOOP
    v_question := NULLIF(v_attempt->>'question_id','')::uuid;
    v_competency := COALESCE(
      NULLIF(v_attempt->>'competency_id','')::uuid,
      public._resolve_competency_for_question(v_question)
    );
    IF v_competency IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_correct := COALESCE((v_attempt->>'correct')::boolean, false);
    v_response_ms := NULLIF(v_attempt->>'response_ms','')::integer;
    v_misc := COALESCE(v_attempt->'misconception_tags', '[]'::jsonb);
    PERFORM public.update_mastery_from_attempt(
      p_user_id, p_course_id, v_competency, v_correct,
      v_response_ms, p_event_type, v_question, v_misc);
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'skipped_no_competency', v_skipped);
END $$;

-- ================================================================
-- 7) Bridge in update_mastery_from_minicheck → also write v2 state
-- ================================================================
CREATE OR REPLACE FUNCTION public.update_mastery_from_minicheck(
  p_user_id uuid, p_competency_id uuid, p_curriculum_id uuid, p_score numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE new_level text; old_level text; v_v2 jsonb;
BEGIN
  new_level := CASE WHEN p_score >= 0.8 THEN 'mastered' WHEN p_score >= 0.5 THEN 'partial' ELSE 'not_mastered' END;
  SELECT mastery_level INTO old_level FROM public.user_competency_progress WHERE user_id = p_user_id AND competency_id = p_competency_id;
  INSERT INTO public.user_competency_progress (user_id, competency_id, curriculum_id, mastery_level, score, attempts, last_updated)
  VALUES (p_user_id, p_competency_id, p_curriculum_id, new_level, p_score, 1, now())
  ON CONFLICT (user_id, competency_id) DO UPDATE SET
    mastery_level = new_level, score = p_score, curriculum_id = p_curriculum_id,
    attempts = user_competency_progress.attempts + 1, last_updated = now();

  -- Bridge to v2 (treat curriculum_id as course_id; map score to N correct/incorrect proxies via single attempt)
  BEGIN
    v_v2 := public.update_mastery_from_attempt(
      p_user_id, p_curriculum_id, p_competency_id,
      p_score >= 0.5,                -- "correct" proxy
      NULL, 'minicheck', NULL,
      CASE WHEN p_score < 0.5 THEN '["minicheck_low_score"]'::jsonb ELSE '[]'::jsonb END
    );
  EXCEPTION WHEN OTHERS THEN
    v_v2 := jsonb_build_object('bridge_error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'competency_id',p_competency_id,'old_level',COALESCE(old_level,'none'),
    'new_level',new_level,'score',p_score,
    'level_changed',COALESCE(old_level,'none') IS DISTINCT FROM new_level,
    'v2_bridge', v_v2
  );
END; $function$;

-- ================================================================
-- 8) Admin: get/update config (audited)
-- ================================================================
CREATE OR REPLACE FUNCTION public.admin_get_mastery_engine_config()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN (SELECT to_jsonb(c) FROM public.mastery_engine_config c WHERE id='singleton');
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_mastery_engine_config(
  p_decay_tau_days numeric DEFAULT NULL,
  p_ewma_alpha numeric DEFAULT NULL,
  p_confidence_sample_anchor numeric DEFAULT NULL,
  p_repair_threshold numeric DEFAULT NULL,
  p_drill_threshold numeric DEFAULT NULL,
  p_reinforce_threshold numeric DEFAULT NULL,
  p_decay_alert_threshold numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  SELECT to_jsonb(c) INTO v_before FROM public.mastery_engine_config c WHERE id='singleton';

  UPDATE public.mastery_engine_config SET
    decay_tau_days = COALESCE(p_decay_tau_days, decay_tau_days),
    ewma_alpha = COALESCE(p_ewma_alpha, ewma_alpha),
    confidence_sample_anchor = COALESCE(p_confidence_sample_anchor, confidence_sample_anchor),
    repair_threshold = COALESCE(p_repair_threshold, repair_threshold),
    drill_threshold = COALESCE(p_drill_threshold, drill_threshold),
    reinforce_threshold = COALESCE(p_reinforce_threshold, reinforce_threshold),
    decay_alert_threshold = COALESCE(p_decay_alert_threshold, decay_alert_threshold),
    updated_at = now(), updated_by = auth.uid()
   WHERE id='singleton';

  SELECT to_jsonb(c) INTO v_after FROM public.mastery_engine_config c WHERE id='singleton';

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('mastery_engine_config_update','system','mastery_config','success',
          jsonb_build_object('before', v_before, 'after', v_after, 'admin_id', auth.uid()));

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END $$;

-- ================================================================
-- 9) Simulator RPCs (pure, no side-effects, admin-gated)
-- ================================================================
CREATE OR REPLACE FUNCTION public.admin_simulate_mastery_decay(
  p_initial_mastery numeric, p_days_array integer[],
  p_tau_override numeric DEFAULT NULL
)
RETURNS TABLE(day integer, mastery_score numeric, decay_score numeric, exam_readiness numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tau numeric;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  SELECT COALESCE(p_tau_override, decay_tau_days) INTO v_tau FROM public.fn_get_mastery_config();
  IF v_tau <= 0 THEN RAISE EXCEPTION 'tau must be > 0'; END IF;
  RETURN QUERY
    SELECT d AS day,
           ROUND(p_initial_mastery::numeric, 2),
           ROUND((100 * exp(- d::numeric / v_tau))::numeric, 2),
           ROUND((p_initial_mastery * (100 * exp(- d::numeric / v_tau))/100.0)::numeric, 2)
      FROM unnest(p_days_array) AS d;
END $$;

CREATE OR REPLACE FUNCTION public.admin_simulate_mastery_path(
  p_attempts jsonb,
  p_tau_override numeric DEFAULT NULL,
  p_alpha_override numeric DEFAULT NULL,
  p_anchor_override numeric DEFAULT NULL
)
RETURNS TABLE(step integer, days_since_prev integer, correct boolean,
              mastery_score numeric, confidence numeric, decay_score numeric, exam_readiness numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg record;
  v_tau numeric; v_alpha numeric; v_anchor numeric;
  v_attempt jsonb; v_step integer := 0;
  v_mastery numeric := 0; v_samples integer := 0;
  v_confidence numeric; v_decay numeric; v_readiness numeric;
  v_days integer; v_correct boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  SELECT * INTO v_cfg FROM public.fn_get_mastery_config();
  v_tau := COALESCE(p_tau_override, v_cfg.decay_tau_days);
  v_alpha := COALESCE(p_alpha_override, v_cfg.ewma_alpha);
  v_anchor := COALESCE(p_anchor_override, v_cfg.confidence_sample_anchor);
  IF v_tau <= 0 OR v_alpha <= 0 OR v_alpha > 1 OR v_anchor <= 0 THEN
    RAISE EXCEPTION 'invalid parameters: tau=% alpha=% anchor=%', v_tau, v_alpha, v_anchor;
  END IF;

  FOR v_attempt IN SELECT * FROM jsonb_array_elements(p_attempts) LOOP
    v_step := v_step + 1;
    v_days := COALESCE((v_attempt->>'days_since_prev')::integer, 0);
    v_correct := COALESCE((v_attempt->>'correct')::boolean, false);
    -- Apply EWMA, then decay/confidence based on samples and elapsed days
    v_mastery := v_mastery + v_alpha * ((CASE WHEN v_correct THEN 100 ELSE 0 END) - v_mastery);
    v_samples := v_samples + 1;
    v_confidence := 100 * (1 - exp(- v_samples::numeric / v_anchor));
    v_decay := LEAST(100, GREATEST(0, 100 * exp(- v_days::numeric / v_tau)));
    v_readiness := v_mastery * (v_confidence/100.0) * (v_decay/100.0);
    step := v_step; days_since_prev := v_days; correct := v_correct;
    mastery_score := ROUND(v_mastery,2); confidence := ROUND(v_confidence,2);
    decay_score := ROUND(v_decay,2); exam_readiness := ROUND(v_readiness,2);
    RETURN NEXT;
  END LOOP;
END $$;

-- ================================================================
-- 10) Grants
-- ================================================================
GRANT EXECUTE ON FUNCTION public.fn_get_mastery_config() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_mastery_from_attempt(uuid,uuid,uuid,boolean,integer,text,uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_attempt_mastery_bulk(uuid,uuid,text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.learner_next_best_step(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public._resolve_competency_for_question(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_mastery_engine_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_mastery_engine_config(numeric,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_simulate_mastery_decay(numeric,integer[],numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_simulate_mastery_path(jsonb,numeric,numeric,numeric) TO authenticated;

-- Audit
INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
VALUES ('s3_mastery_v2_consolidation','system','mastery_engine','success',
        jsonb_build_object('migration','s3_m1','components',
          jsonb_build_array('mastery_engine_config','update_mastery_from_attempt_v2',
            'learner_next_best_step_payload','record_attempt_mastery_bulk',
            'minicheck_v2_bridge','simulator_rpcs')));