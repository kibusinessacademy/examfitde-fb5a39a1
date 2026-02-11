
-- Council v2: Deliberative Architecture – Content Versioning, Debate, Verdict, Publish Gate

-- 1) Enumerations
DO $$ BEGIN
  CREATE TYPE public.content_version_status AS ENUM ('proposed','under_review','revise','rejected','approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.council_message_type AS ENUM ('proposal','critique','revision','defense','vote','verdict','audit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.council_decision AS ENUM ('approved','revise','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Content versions (per lesson step)
CREATE TABLE IF NOT EXISTS public.content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  content_json jsonb NOT NULL,
  created_by_agent text NOT NULL,
  created_by_job_id uuid NULL,
  status public.content_version_status NOT NULL DEFAULT 'proposed',
  council_round int NOT NULL DEFAULT 1,
  parent_version_id uuid NULL REFERENCES public.content_versions(id) ON DELETE SET NULL,
  quality_score numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_versions_lesson_step
ON public.content_versions (lesson_id, step_key, status, created_at DESC);

-- 3) Council conversation thread per content_version
CREATE TABLE IF NOT EXISTS public.council_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_version_id uuid NOT NULL REFERENCES public.content_versions(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  message_type public.council_message_type NOT NULL,
  message_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_council_messages_version
ON public.council_messages (content_version_id, created_at ASC);

-- 4) Votes
CREATE TABLE IF NOT EXISTS public.council_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_version_id uuid NOT NULL REFERENCES public.content_versions(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  vote public.council_decision NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.7,
  rationale text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_version_id, agent_name)
);

-- 5) Verdict (single source of truth for decision)
CREATE TABLE IF NOT EXISTS public.council_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_version_id uuid NOT NULL UNIQUE REFERENCES public.content_versions(id) ON DELETE CASCADE,
  final_decision public.council_decision NOT NULL,
  consensus_score numeric NOT NULL DEFAULT 0,
  required_fixes jsonb NULL,
  decided_by text NOT NULL DEFAULT 'council',
  decided_at timestamptz NOT NULL DEFAULT now()
);

-- 6) Lesson publication pointer (hard gate)
ALTER TABLE public.lessons
ADD COLUMN IF NOT EXISTS published_versions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 7) Helper: mark approved version as published for a lesson step
CREATE OR REPLACE FUNCTION public.publish_approved_version(
  p_lesson_id uuid,
  p_step_key text,
  p_version_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.content_version_status;
BEGIN
  SELECT status INTO v_status FROM public.content_versions WHERE id = p_version_id;
  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot publish version %, status=% (must be approved)', p_version_id, v_status;
  END IF;

  UPDATE public.lessons
  SET published_versions =
    jsonb_set(published_versions, ARRAY[p_step_key], to_jsonb(p_version_id::text), true)
  WHERE id = p_lesson_id;
END $$;

-- 8) Course publish gate
ALTER TABLE public.courses
ADD COLUMN IF NOT EXISTS is_ready_for_publish boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.recompute_course_publish_readiness(p_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_steps int;
  v_approved_steps int;
  v_ratio numeric;
BEGIN
  SELECT COUNT(*) INTO v_total_steps
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id;

  SELECT COUNT(*) INTO v_approved_steps
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id
    AND (l.published_versions ? 'step_1_introduction')
    AND (l.published_versions ? 'step_2_understanding')
    AND (l.published_versions ? 'step_3_application')
    AND (l.published_versions ? 'step_4_repetition')
    AND (l.published_versions ? 'step_5_minicheck');

  IF v_total_steps = 0 THEN
    v_ratio := 0;
  ELSE
    v_ratio := v_approved_steps::numeric / v_total_steps::numeric;
  END IF;

  UPDATE public.courses
  SET is_ready_for_publish = (v_ratio >= 0.95)
  WHERE id = p_course_id;
END $$;

-- 9) RLS: Council tables admin-only
ALTER TABLE public.content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_verdicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_content_versions" ON public.content_versions FOR ALL
USING (public.is_admin_user(auth.uid()));

CREATE POLICY "admin_council_messages" ON public.council_messages FOR ALL
USING (public.is_admin_user(auth.uid()));

CREATE POLICY "admin_council_votes" ON public.council_votes FOR ALL
USING (public.is_admin_user(auth.uid()));

CREATE POLICY "admin_council_verdicts" ON public.council_verdicts FOR ALL
USING (public.is_admin_user(auth.uid()));

-- 10) Trigger for updated_at on content_versions
CREATE TRIGGER update_content_versions_updated_at
BEFORE UPDATE ON public.content_versions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
