
-- Test infrastructure tables for Smoke/Sanity/UAT tracking

CREATE TABLE public.test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  env TEXT NOT NULL CHECK (env IN ('staging', 'production', 'local')),
  suite TEXT NOT NULL CHECK (suite IN ('smoke', 'sanity', 'uat')),
  suite_file TEXT,
  git_sha TEXT,
  trigger_source TEXT DEFAULT 'manual' CHECK (trigger_source IN ('manual', 'deploy', 'scheduled', 'ci')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed', 'error')),
  duration_ms INTEGER,
  total_tests INTEGER DEFAULT 0,
  passed_tests INTEGER DEFAULT 0,
  failed_tests INTEGER DEFAULT 0,
  skipped_tests INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.test_runs(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  test_group TEXT,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'error')),
  duration_ms INTEGER,
  error_message TEXT,
  error_snippet TEXT,
  artifact_url TEXT,
  retry_count INTEGER DEFAULT 0,
  is_flaky BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_test_runs_env_suite ON public.test_runs(env, suite);
CREATE INDEX idx_test_runs_status ON public.test_runs(status);
CREATE INDEX idx_test_runs_started ON public.test_runs(started_at DESC);
CREATE INDEX idx_test_results_run_id ON public.test_results(run_id);
CREATE INDEX idx_test_results_status ON public.test_results(status);
CREATE INDEX idx_test_results_flaky ON public.test_results(is_flaky) WHERE is_flaky = true;

-- Enable RLS
ALTER TABLE public.test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

-- Admin read access (via has_role)
CREATE POLICY "Admins can read test_runs"
  ON public.test_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can read test_results"
  ON public.test_results FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.test_runs tr
    WHERE tr.id = test_results.run_id
    AND public.has_role(auth.uid(), 'admin')
  ));

-- Service role can insert/update (Edge Functions)
CREATE POLICY "Service can manage test_runs"
  ON public.test_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service can manage test_results"
  ON public.test_results FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- View: flaky test detection (tests that flip status across runs)
CREATE OR REPLACE VIEW public.v_flaky_tests WITH (security_invoker = on) AS
SELECT
  tr.test_name,
  COUNT(*) AS total_runs,
  COUNT(*) FILTER (WHERE tr.status = 'passed') AS pass_count,
  COUNT(*) FILTER (WHERE tr.status = 'failed') AS fail_count,
  ROUND(COUNT(*) FILTER (WHERE tr.status = 'failed')::numeric / GREATEST(COUNT(*), 1) * 100, 1) AS fail_rate_pct,
  MAX(tr.created_at) AS last_seen
FROM public.test_results tr
GROUP BY tr.test_name
HAVING COUNT(*) >= 3
  AND COUNT(*) FILTER (WHERE tr.status = 'passed') > 0
  AND COUNT(*) FILTER (WHERE tr.status = 'failed') > 0
ORDER BY fail_rate_pct DESC;
