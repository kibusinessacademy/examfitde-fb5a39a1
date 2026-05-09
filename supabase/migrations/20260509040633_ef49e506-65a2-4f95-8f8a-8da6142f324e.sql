
-- Track B Logic: update_mastery_from_attempt + summary view

CREATE OR REPLACE FUNCTION public.update_mastery_from_attempt(
  p_user_id uuid,
  p_course_id uuid,
  p_competency_id uuid,
  p_correct boolean,
  p_response_ms integer DEFAULT NULL,
  p_event_type text DEFAULT 'quiz',
  p_question_id uuid DEFAULT NULL,
  p_misconception_tags jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_alpha numeric := 0.30;
  v_caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  v_state public.learner_competency_state%ROWTYPE;
  v_mastery_before numeric;
  v_mastery_after numeric;
  v_confidence numeric;
  v_decay numeric;
  v_readiness numeric;
  v_days numeric;
  v_new_avg_ms numeric;
  v_existing_pattern jsonb;
  v_recurring jsonb;
  v_misconceptions jsonb;
BEGIN
  IF p_user_id IS NULL OR p_course_id IS NULL OR p_competency_id IS NULL THEN
    RAISE EXCEPTION 'user_id, course_id, competency_id required';
  END IF;
  IF v_caller_role <> 'service_role' AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'cannot update mastery for another user';
  END IF;

  SELECT * INTO v_state
    FROM public.learner_competency_state
   WHERE user_id=p_user_id AND course_id=p_course_id AND competency_id=p_competency_id
   FOR UPDATE;

  v_mastery_before := COALESCE(v_state.mastery_score, 0);

  -- EWMA mastery
  v_mastery_after := v_mastery_before + v_alpha * ( (CASE WHEN p_correct THEN 100 ELSE 0 END) - v_mastery_before );

  -- Decay since last practice
  v_days := COALESCE(EXTRACT(EPOCH FROM (now() - COALESCE(v_state.last_practice_at, now())))/86400.0, 0);
  v_decay := LEAST(100, GREATEST(0, 100 * exp(- v_days / 14.0)));

  -- Confidence from sample-size
  v_confidence := 100 * (1 - exp(- (COALESCE(v_state.samples_total,0) + 1) / 8.0));

  v_readiness := v_mastery_after * (v_confidence/100.0) * (v_decay/100.0);

  -- Error pattern update
  v_existing_pattern := COALESCE(v_state.error_pattern, jsonb_build_object(
    'misconception_tags','[]'::jsonb,
    'recurring_question_ids','[]'::jsonb,
    'avg_response_ms',0,
    'hint_usage_rate',0
  ));

  v_new_avg_ms := CASE
    WHEN p_response_ms IS NULL THEN COALESCE((v_existing_pattern->>'avg_response_ms')::numeric,0)
    WHEN COALESCE(v_state.samples_total,0) = 0 THEN p_response_ms::numeric
    ELSE ((COALESCE((v_existing_pattern->>'avg_response_ms')::numeric,0) * v_state.samples_total) + p_response_ms) / (v_state.samples_total + 1)
  END;

  IF NOT p_correct AND p_question_id IS NOT NULL THEN
    v_recurring := COALESCE(v_existing_pattern->'recurring_question_ids', '[]'::jsonb)
                   || jsonb_build_array(p_question_id);
    -- cap at 50
    IF jsonb_array_length(v_recurring) > 50 THEN
      v_recurring := (SELECT jsonb_agg(x) FROM (
        SELECT x FROM jsonb_array_elements(v_recurring) x
        ORDER BY 1 DESC LIMIT 50) s);
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
    user_id, course_id, competency_id,
    mastery_score, confidence, decay_score, exam_readiness,
    error_pattern, samples_total, samples_correct,
    last_practice_at, last_event_type, updated_at
  )
  VALUES (
    p_user_id, p_course_id, p_competency_id,
    ROUND(v_mastery_after::numeric,2), ROUND(v_confidence::numeric,2),
    ROUND(v_decay::numeric,2), ROUND(v_readiness::numeric,2),
    jsonb_build_object(
      'misconception_tags', v_misconceptions,
      'recurring_question_ids', v_recurring,
      'avg_response_ms', ROUND(v_new_avg_ms,0),
      'hint_usage_rate', COALESCE((v_existing_pattern->>'hint_usage_rate')::numeric,0)
    ),
    1, CASE WHEN p_correct THEN 1 ELSE 0 END,
    now(), p_event_type, now()
  )
  ON CONFLICT (user_id, course_id, competency_id) DO UPDATE SET
    mastery_score = EXCLUDED.mastery_score,
    confidence = EXCLUDED.confidence,
    decay_score = EXCLUDED.decay_score,
    exam_readiness = EXCLUDED.exam_readiness,
    error_pattern = EXCLUDED.error_pattern,
    samples_total = public.learner_competency_state.samples_total + 1,
    samples_correct = public.learner_competency_state.samples_correct + (CASE WHEN p_correct THEN 1 ELSE 0 END),
    last_practice_at = now(),
    last_event_type = EXCLUDED.last_event_type,
    updated_at = now();

  INSERT INTO public.learner_mastery_event_log(
    user_id, course_id, competency_id, event_type, is_correct, response_ms,
    question_id, misconception_tags, mastery_before, mastery_after, exam_readiness_after
  )
  VALUES (
    p_user_id, p_course_id, p_competency_id, p_event_type, p_correct, p_response_ms,
    p_question_id, p_misconception_tags,
    ROUND(v_mastery_before,2), ROUND(v_mastery_after,2), ROUND(v_readiness,2)
  );

  RETURN jsonb_build_object(
    'mastery_before', ROUND(v_mastery_before,2),
    'mastery_after', ROUND(v_mastery_after,2),
    'confidence', ROUND(v_confidence,2),
    'decay_score', ROUND(v_decay,2),
    'exam_readiness', ROUND(v_readiness,2)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.update_mastery_from_attempt(uuid,uuid,uuid,boolean,integer,text,uuid,jsonb) TO authenticated, service_role;

-- Summary view: per (user, course)
CREATE OR REPLACE VIEW public.v_learner_mastery_summary AS
WITH ranked AS (
  SELECT
    s.user_id, s.course_id, s.competency_id,
    s.exam_readiness, s.decay_score, s.mastery_score,
    c.title AS competency_title,
    ROW_NUMBER() OVER (PARTITION BY s.user_id, s.course_id ORDER BY s.exam_readiness ASC) AS asc_rank,
    ROW_NUMBER() OVER (PARTITION BY s.user_id, s.course_id ORDER BY s.exam_readiness DESC) AS desc_rank
  FROM public.learner_competency_state s
  LEFT JOIN public.competencies c ON c.id = s.competency_id
)
SELECT
  user_id,
  course_id,
  ROUND(AVG(exam_readiness)::numeric, 2) AS avg_readiness,
  COUNT(*)::int AS competencies_total,
  COUNT(*) FILTER (WHERE decay_score < 50)::int AS decay_alerts,
  MAX(GREATEST(mastery_score, 0)) AS max_mastery,
  jsonb_agg(jsonb_build_object('competency_id',competency_id,'title',competency_title,'readiness',exam_readiness))
    FILTER (WHERE asc_rank <= 3) AS weakest_3,
  jsonb_agg(jsonb_build_object('competency_id',competency_id,'title',competency_title,'readiness',exam_readiness))
    FILTER (WHERE desc_rank <= 3) AS strongest_3
FROM ranked
GROUP BY user_id, course_id;

-- View RLS via SECURITY INVOKER on access — convert to RPC for safety
CREATE OR REPLACE FUNCTION public.learner_get_mastery_summary(p_course_id uuid)
RETURNS TABLE(
  avg_readiness numeric,
  competencies_total int,
  decay_alerts int,
  weakest_3 jsonb,
  strongest_3 jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  RETURN QUERY
    SELECT v.avg_readiness, v.competencies_total, v.decay_alerts, v.weakest_3, v.strongest_3
      FROM public.v_learner_mastery_summary v
     WHERE v.user_id = auth.uid() AND v.course_id = p_course_id;
END $$;

GRANT EXECUTE ON FUNCTION public.learner_get_mastery_summary(uuid) TO authenticated;
