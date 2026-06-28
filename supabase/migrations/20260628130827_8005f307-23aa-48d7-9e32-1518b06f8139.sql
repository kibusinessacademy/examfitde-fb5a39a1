
-- PIPELINE.RECOVERY.OS.2 — Recovery Runs + Outcome Verification
CREATE TABLE IF NOT EXISTS public.pipeline_recovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL UNIQUE,
  plan_hash text,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'executing' CHECK (status IN ('executing','executed','verifying','verified','verified_partial','verified_regressed','timeout','failed')),
  reason text NOT NULL,
  action_ids text[] NOT NULL DEFAULT '{}',
  pre_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  verified_at timestamptz
);

GRANT SELECT ON public.pipeline_recovery_runs TO authenticated;
GRANT ALL ON public.pipeline_recovery_runs TO service_role;

ALTER TABLE public.pipeline_recovery_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recovery_runs_admin_read" ON public.pipeline_recovery_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "recovery_runs_service_all" ON public.pipeline_recovery_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_recovery_runs_status ON public.pipeline_recovery_runs(status, created_at DESC);

-- Extend actions with verification fields (no breaking changes)
ALTER TABLE public.pipeline_recovery_actions
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS pre_state jsonb,
  ADD COLUMN IF NOT EXISTS post_state jsonb,
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending_verification' CHECK (verification_status IN ('pending_verification','verified_success','verified_no_change','verified_regressed','verification_timeout','skipped')),
  ADD COLUMN IF NOT EXISTS verification_detail jsonb;

CREATE INDEX IF NOT EXISTS idx_recovery_actions_run ON public.pipeline_recovery_actions(run_id);
