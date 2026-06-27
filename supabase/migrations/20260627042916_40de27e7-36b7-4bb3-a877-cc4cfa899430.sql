
-- VISUAL.LEARNING.OS — Cut 7: Persistence & Approval Workflow

CREATE TABLE IF NOT EXISTS public.visual_learning_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  curriculum_id text NOT NULL,
  competence_id text NOT NULL,
  lesson_id text NULL,
  blueprint_id text NULL,
  artifact_type text NOT NULL,
  pattern text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','needs_review','approved','published','archived')),
  version integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  artifact_json jsonb NOT NULL,
  review_json jsonb NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NULL,
  reviewed_by uuid NULL,
  published_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  published_at timestamptz NULL,
  archived_at timestamptz NULL
);

GRANT SELECT ON public.visual_learning_artifacts TO authenticated;
GRANT ALL ON public.visual_learning_artifacts TO service_role;

ALTER TABLE public.visual_learning_artifacts ENABLE ROW LEVEL SECURITY;

-- Admin sees everything
CREATE POLICY "vlo_artifacts_admin_select"
  ON public.visual_learning_artifacts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Learners can read only published
CREATE POLICY "vlo_artifacts_learner_published_select"
  ON public.visual_learning_artifacts FOR SELECT TO authenticated
  USING (status = 'published');

-- No client writes — all writes go through edge function (service_role)
-- (no INSERT/UPDATE/DELETE policies for authenticated)

CREATE INDEX IF NOT EXISTS idx_vlo_artifacts_curr_comp
  ON public.visual_learning_artifacts (curriculum_id, competence_id);
CREATE INDEX IF NOT EXISTS idx_vlo_artifacts_lesson
  ON public.visual_learning_artifacts (lesson_id);
CREATE INDEX IF NOT EXISTS idx_vlo_artifacts_status
  ON public.visual_learning_artifacts (status);
CREATE INDEX IF NOT EXISTS idx_vlo_artifacts_blueprint
  ON public.visual_learning_artifacts (blueprint_id);
CREATE INDEX IF NOT EXISTS idx_vlo_artifacts_published_at
  ON public.visual_learning_artifacts (published_at DESC);

CREATE TRIGGER trg_vlo_artifacts_updated_at
  BEFORE UPDATE ON public.visual_learning_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Events table
CREATE TABLE IF NOT EXISTS public.visual_learning_artifact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.visual_learning_artifacts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text NULL,
  to_status text NULL,
  actor_id uuid NULL,
  event_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.visual_learning_artifact_events TO authenticated;
GRANT ALL ON public.visual_learning_artifact_events TO service_role;

ALTER TABLE public.visual_learning_artifact_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vlo_events_admin_select"
  ON public.visual_learning_artifact_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_vlo_events_artifact
  ON public.visual_learning_artifact_events (artifact_id, created_at DESC);
