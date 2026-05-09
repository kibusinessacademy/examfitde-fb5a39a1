
-- 1. Harden record_attempt_mastery_bulk against anon callers
CREATE OR REPLACE FUNCTION public.record_attempt_mastery_bulk(
  p_user_id uuid, p_course_id uuid, p_event_type text, p_attempts jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
  v_caller uuid := auth.uid();
  v_attempt jsonb; v_competency uuid; v_question uuid; v_correct boolean;
  v_response_ms integer; v_misc jsonb;
  v_processed integer := 0; v_skipped integer := 0;
BEGIN
  -- Only service_role OR the user themselves may write attempts
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    IF v_caller IS NULL OR v_caller <> p_user_id THEN
      RAISE EXCEPTION 'cannot record attempts for another user';
    END IF;
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
    IF v_competency IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    v_correct := COALESCE((v_attempt->>'correct')::boolean, false);
    v_response_ms := NULLIF(v_attempt->>'response_ms','')::integer;
    v_misc := COALESCE(v_attempt->'misconception_tags', '[]'::jsonb);
    PERFORM public.update_mastery_from_attempt(
      p_user_id, p_course_id, v_competency, v_correct,
      v_response_ms, p_event_type, v_question, v_misc);
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'skipped_no_competency', v_skipped);
END $function$;

-- 2. learner_competency_state_history snapshot table
CREATE TABLE IF NOT EXISTS public.learner_competency_state_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  course_id uuid NOT NULL,
  competency_id uuid NOT NULL,
  mastery_score numeric(5,2) NOT NULL,
  confidence numeric(5,2) NOT NULL,
  decay_score numeric(5,2) NOT NULL,
  exam_readiness numeric(5,2) NOT NULL,
  samples_total integer NOT NULL,
  event_type text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lcs_history_user_course_time
  ON public.learner_competency_state_history (user_id, course_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_lcs_history_competency_time
  ON public.learner_competency_state_history (user_id, course_id, competency_id, recorded_at DESC);

ALTER TABLE public.learner_competency_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lcs_history_self_select ON public.learner_competency_state_history;
CREATE POLICY lcs_history_self_select
  ON public.learner_competency_state_history
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- Trigger: snapshot on update
CREATE OR REPLACE FUNCTION public.fn_snapshot_learner_competency_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.learner_competency_state_history
    (user_id, course_id, competency_id, mastery_score, confidence,
     decay_score, exam_readiness, samples_total, event_type)
  VALUES
    (NEW.user_id, NEW.course_id, NEW.competency_id, NEW.mastery_score, NEW.confidence,
     NEW.decay_score, NEW.exam_readiness, NEW.samples_total, NEW.last_event_type);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_snapshot_learner_competency_state
  ON public.learner_competency_state;
CREATE TRIGGER trg_snapshot_learner_competency_state
  AFTER INSERT OR UPDATE ON public.learner_competency_state
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_snapshot_learner_competency_state();

-- RPC: learner reads own history
CREATE OR REPLACE FUNCTION public.learner_get_competency_history(
  p_course_id uuid,
  p_days integer DEFAULT 90,
  p_competency_id uuid DEFAULT NULL
) RETURNS TABLE (
  competency_id uuid,
  competency_title text,
  recorded_at timestamptz,
  mastery_score numeric,
  confidence numeric,
  decay_score numeric,
  exam_readiness numeric,
  samples_total integer,
  event_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.competency_id,
         c.title AS competency_title,
         h.recorded_at,
         h.mastery_score,
         h.confidence,
         h.decay_score,
         h.exam_readiness,
         h.samples_total,
         h.event_type
  FROM public.learner_competency_state_history h
  LEFT JOIN public.competencies c ON c.id = h.competency_id
  WHERE h.user_id = auth.uid()
    AND h.course_id = p_course_id
    AND (p_competency_id IS NULL OR h.competency_id = p_competency_id)
    AND h.recorded_at >= now() - (GREATEST(p_days,1) || ' days')::interval
  ORDER BY h.recorded_at ASC;
$$;

REVOKE ALL ON FUNCTION public.learner_get_competency_history(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learner_get_competency_history(uuid,integer,uuid)
  TO authenticated;

-- 3. Server-side filtered export RPC for gate decision history
CREATE OR REPLACE FUNCTION public.admin_get_gate_decision_package_timeline_filtered(
  p_package_id uuid,
  p_window_days integer DEFAULT 90,
  p_lane text DEFAULT NULL,
  p_decision text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid,
  decision text,
  prev_decision text,
  quality_score numeric,
  quality_badge text,
  bronze_locked boolean,
  recorded_at timestamptz,
  recorded_by text,
  inputs jsonb,
  total_rows bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT g.*
    FROM public.quality_gate_decision_history g
    WHERE g.package_id = p_package_id
      AND g.recorded_at >= now() - (GREATEST(p_window_days,1) || ' days')::interval
      AND (p_decision IS NULL OR g.decision = p_decision)
      AND (p_lane IS NULL OR (g.inputs->>'lane') = p_lane)
  ), counted AS (
    SELECT COUNT(*) AS c FROM base
  )
  SELECT b.id, b.decision, b.prev_decision, b.quality_score, b.quality_badge,
         b.bronze_locked, b.recorded_at, b.recorded_by::text, b.inputs,
         (SELECT c FROM counted)
  FROM base b
  ORDER BY b.recorded_at DESC
  LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0);
END $$;

REVOKE ALL ON FUNCTION public.admin_get_gate_decision_package_timeline_filtered(uuid,integer,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_gate_decision_package_timeline_filtered(uuid,integer,text,text,integer,integer)
  TO authenticated;
