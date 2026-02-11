
-- =====================================================
-- Council 4: Assessment Council – Schema + Gates
-- =====================================================

-- 1) Add approved_version_id to question_blueprints
ALTER TABLE public.question_blueprints
ADD COLUMN IF NOT EXISTS approved_version_id uuid NULL;

-- 2) Add approved_version_id + blueprint_id to exam_questions
ALTER TABLE public.exam_questions
ADD COLUMN IF NOT EXISTS approved_version_id uuid NULL,
ADD COLUMN IF NOT EXISTS blueprint_id uuid NULL;

DO $$ BEGIN
  ALTER TABLE public.exam_questions
  ADD CONSTRAINT exam_questions_blueprint_fk
  FOREIGN KEY (blueprint_id) REFERENCES public.question_blueprints(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) MiniCheck Sets
CREATE TABLE IF NOT EXISTS public.minicheck_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','under_review','revise','rejected','approved')),
  approved_version_id uuid NULL,
  question_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lesson_id)
);

-- 4) MiniCheck Set Items
CREATE TABLE IF NOT EXISTS public.minicheck_set_items (
  minicheck_set_id uuid NOT NULL REFERENCES public.minicheck_sets(id) ON DELETE CASCADE,
  exam_question_id uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE RESTRICT,
  position int NOT NULL,
  PRIMARY KEY (minicheck_set_id, exam_question_id)
);

CREATE INDEX IF NOT EXISTS idx_minicheck_items_set
ON public.minicheck_set_items(minicheck_set_id, position);

-- 5) RPC: approve_blueprint_version
CREATE OR REPLACE FUNCTION public.approve_blueprint_version(
  p_blueprint_id uuid,
  p_version_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_decision text;
BEGIN
  SELECT status INTO v_status FROM public.content_versions WHERE id = p_version_id;
  SELECT final_decision INTO v_decision FROM public.council_verdicts WHERE content_version_id = p_version_id;

  IF v_status IS DISTINCT FROM 'approved' OR v_decision IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot approve blueprint: version not approved (status=% verdict=%)', v_status, v_decision;
  END IF;

  UPDATE public.question_blueprints
  SET status = 'approved',
      approved_version_id = p_version_id,
      approved_at = now()
  WHERE id = p_blueprint_id;
END $$;

-- 6) RPC: approve_minicheck_set_version
CREATE OR REPLACE FUNCTION public.approve_minicheck_set_version(
  p_minicheck_set_id uuid,
  p_version_id uuid,
  p_min_questions int DEFAULT 5
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_decision text;
  v_qcount int;
BEGIN
  SELECT status INTO v_status FROM public.content_versions WHERE id = p_version_id;
  SELECT final_decision INTO v_decision FROM public.council_verdicts WHERE content_version_id = p_version_id;

  IF v_status IS DISTINCT FROM 'approved' OR v_decision IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot approve minicheck: version not approved (status=% verdict=%)', v_status, v_decision;
  END IF;

  SELECT COUNT(*) INTO v_qcount FROM public.minicheck_set_items WHERE minicheck_set_id = p_minicheck_set_id;
  IF v_qcount < p_min_questions THEN
    RAISE EXCEPTION 'Cannot approve minicheck: only % questions (min %)', v_qcount, p_min_questions;
  END IF;

  UPDATE public.minicheck_sets
  SET status = 'approved',
      approved_version_id = p_version_id,
      question_count = v_qcount,
      updated_at = now()
  WHERE id = p_minicheck_set_id;
END $$;

-- 7) Guard: minicheck items must reference approved exam_questions
CREATE OR REPLACE FUNCTION public.guard_minicheck_items_approved()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_q_status text;
BEGIN
  SELECT status INTO v_q_status FROM public.exam_questions WHERE id = NEW.exam_question_id;
  IF v_q_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'MiniCheck item blocked: exam_question % not approved (status=%)', NEW.exam_question_id, v_q_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_minicheck_items_approved ON public.minicheck_set_items;
CREATE TRIGGER trg_guard_minicheck_items_approved
BEFORE INSERT OR UPDATE ON public.minicheck_set_items
FOR EACH ROW EXECUTE FUNCTION public.guard_minicheck_items_approved();

-- 8) RLS
ALTER TABLE public.minicheck_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minicheck_set_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_minicheck_sets
ON public.minicheck_sets FOR ALL
USING (public.is_admin_user(auth.uid()));

CREATE POLICY admin_all_minicheck_items
ON public.minicheck_set_items FOR ALL
USING (public.is_admin_user(auth.uid()));
