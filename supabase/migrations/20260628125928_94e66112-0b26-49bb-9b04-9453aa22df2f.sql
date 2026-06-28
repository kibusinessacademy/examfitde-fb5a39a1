
CREATE TABLE IF NOT EXISTS public.pipeline_recovery_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope TEXT NOT NULL DEFAULT 'full',
  summary JSONB NOT NULL,
  plan JSONB NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pipeline_recovery_plans TO authenticated;
GRANT ALL ON public.pipeline_recovery_plans TO service_role;
ALTER TABLE public.pipeline_recovery_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read recovery plans"
  ON public.pipeline_recovery_plans FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages recovery plans"
  ON public.pipeline_recovery_plans FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.pipeline_recovery_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.pipeline_recovery_plans(id) ON DELETE SET NULL,
  action_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  cause TEXT NOT NULL,
  target_package_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL,
  actor_uid UUID,
  executed_at TIMESTAMPTZ,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(action_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_recovery_actions_pkg ON public.pipeline_recovery_actions(target_package_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_recovery_actions_status ON public.pipeline_recovery_actions(status);

GRANT SELECT ON public.pipeline_recovery_actions TO authenticated;
GRANT ALL ON public.pipeline_recovery_actions TO service_role;
ALTER TABLE public.pipeline_recovery_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read recovery actions"
  ON public.pipeline_recovery_actions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages recovery actions"
  ON public.pipeline_recovery_actions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
