
-- Track B Schema: Learner Competency State + Event Log

CREATE TABLE IF NOT EXISTS public.learner_competency_state (
  user_id uuid NOT NULL,
  course_id uuid NOT NULL,
  competency_id uuid NOT NULL REFERENCES public.competencies(id) ON DELETE CASCADE,
  mastery_score numeric(5,2) NOT NULL DEFAULT 0 CHECK (mastery_score >= 0 AND mastery_score <= 100),
  confidence numeric(5,2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  decay_score numeric(5,2) NOT NULL DEFAULT 100 CHECK (decay_score >= 0 AND decay_score <= 100),
  exam_readiness numeric(5,2) NOT NULL DEFAULT 0 CHECK (exam_readiness >= 0 AND exam_readiness <= 100),
  error_pattern jsonb NOT NULL DEFAULT jsonb_build_object(
    'misconception_tags', '[]'::jsonb,
    'recurring_question_ids', '[]'::jsonb,
    'avg_response_ms', 0,
    'hint_usage_rate', 0
  ),
  samples_total integer NOT NULL DEFAULT 0,
  samples_correct integer NOT NULL DEFAULT 0,
  last_practice_at timestamptz,
  last_event_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, competency_id)
);

CREATE INDEX IF NOT EXISTS idx_lcs_user_course ON public.learner_competency_state(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_lcs_readiness ON public.learner_competency_state(user_id, course_id, exam_readiness);

ALTER TABLE public.learner_competency_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lcs_self_select" ON public.learner_competency_state;
CREATE POLICY "lcs_self_select" ON public.learner_competency_state
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies → only service_role/SECURITY DEFINER may mutate.

CREATE TABLE IF NOT EXISTS public.learner_mastery_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  course_id uuid NOT NULL,
  competency_id uuid NOT NULL,
  event_type text NOT NULL,
  is_correct boolean,
  response_ms integer,
  question_id uuid,
  misconception_tags jsonb DEFAULT '[]'::jsonb,
  mastery_before numeric(5,2),
  mastery_after numeric(5,2),
  exam_readiness_after numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lmel_user_created ON public.learner_mastery_event_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lmel_competency ON public.learner_mastery_event_log(competency_id, created_at DESC);

ALTER TABLE public.learner_mastery_event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lmel_self_select" ON public.learner_mastery_event_log;
CREATE POLICY "lmel_self_select" ON public.learner_mastery_event_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role));
