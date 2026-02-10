
-- =====================================================
-- Sprint 2+3: Patch System + Experiment Engine
-- =====================================================

-- PATCH PROPOSALS
CREATE TABLE IF NOT EXISTS public.patch_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  patch_type text NOT NULL DEFAULT 'replace',
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  diff_summary text,
  status text NOT NULL DEFAULT 'draft',
  risk text NOT NULL DEFAULT 'medium',
  validator_result jsonb,
  validated_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  applied_at timestamptz,
  apply_error text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS patch_proposals_dedupe_open_uidx
  ON public.patch_proposals(dedupe_key)
  WHERE status IN ('draft','validated','needs_revision','approved') AND dedupe_key IS NOT NULL;

-- PATCH REVISIONS
CREATE TABLE IF NOT EXISTS public.patch_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patch_id uuid NOT NULL REFERENCES public.patch_proposals(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rollback_of uuid
);

-- EXPERIMENTS
CREATE TABLE IF NOT EXISTS public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('seo','sales','learning')),
  name text NOT NULL,
  hypothesis text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','ended')),
  start_at timestamptz,
  end_at timestamptz,
  kpi_name text,
  stop_rules jsonb DEFAULT '{}'::jsonb,
  allocation jsonb NOT NULL DEFAULT '{"A":50,"B":50}'::jsonb,
  variants jsonb NOT NULL DEFAULT '{"A":{},"B":{}}'::jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- EXPERIMENT ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.experiment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  variant text NOT NULL CHECK (variant IN ('A','B')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, user_id)
);

-- EXPERIMENT EVENTS
CREATE TABLE IF NOT EXISTS public.experiment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  user_id uuid,
  event_type text NOT NULL,
  value numeric,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experiment_events_idx ON public.experiment_events(experiment_id, created_at DESC);

-- TRIGGERS (updated_at)
DROP TRIGGER IF EXISTS trg_patch_proposals_updated ON public.patch_proposals;
CREATE TRIGGER trg_patch_proposals_updated
BEFORE UPDATE ON public.patch_proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_experiments_updated ON public.experiments;
CREATE TRIGGER trg_experiments_updated
BEFORE UPDATE ON public.experiments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.patch_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patch_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage patch_proposals"
ON public.patch_proposals FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins manage patch_revisions"
ON public.patch_revisions FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins manage experiments"
ON public.experiments FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins manage experiment_assignments"
ON public.experiment_assignments FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Users insert own experiment_events"
ON public.experiment_events FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins manage experiment_events"
ON public.experiment_events FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));
