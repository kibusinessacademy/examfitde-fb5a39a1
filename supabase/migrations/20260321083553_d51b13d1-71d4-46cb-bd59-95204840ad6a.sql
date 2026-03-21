
CREATE TABLE public.phantom_step_e2e_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id text NOT NULL,
  mode text NOT NULL DEFAULT 'readonly',
  overall_pass boolean NOT NULL,
  verdict text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}',
  layer_summary jsonb NOT NULL DEFAULT '{}',
  results jsonb NOT NULL DEFAULT '[]',
  elapsed_ms integer NOT NULL DEFAULT 0,
  ssot_step_count integer NOT NULL DEFAULT 0,
  canary_package_id uuid,
  triggered_by text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phantom_step_e2e_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.phantom_step_e2e_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read" ON public.phantom_step_e2e_runs
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_phantom_e2e_runs_created ON public.phantom_step_e2e_runs (created_at DESC);
