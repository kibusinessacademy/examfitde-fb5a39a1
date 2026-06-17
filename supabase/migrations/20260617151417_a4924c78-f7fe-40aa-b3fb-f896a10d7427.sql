
CREATE TABLE IF NOT EXISTS public.workflow_simulator_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_key text NOT NULL UNIQUE,
  area text NOT NULL,
  name text NOT NULL,
  description text,
  default_mode text NOT NULL DEFAULT 'smoke',
  is_active boolean NOT NULL DEFAULT true,
  cron_smoke boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workflow_simulator_scenarios TO authenticated;
GRANT ALL ON public.workflow_simulator_scenarios TO service_role;
ALTER TABLE public.workflow_simulator_scenarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wss_admin_read ON public.workflow_simulator_scenarios;
CREATE POLICY wss_admin_read ON public.workflow_simulator_scenarios
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.workflow_simulator_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_key text NOT NULL,
  mode text NOT NULL DEFAULT 'smoke',
  triggered_by text NOT NULL DEFAULT 'admin',
  triggered_user uuid,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  total_steps integer DEFAULT 0,
  passed integer DEFAULT 0,
  failed integer DEFAULT 0,
  skipped integer DEFAULT 0,
  summary jsonb DEFAULT '{}'::jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS idx_wsr_started_at ON public.workflow_simulator_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wsr_scenario ON public.workflow_simulator_runs (scenario_key, started_at DESC);
GRANT SELECT ON public.workflow_simulator_runs TO authenticated;
GRANT ALL ON public.workflow_simulator_runs TO service_role;
ALTER TABLE public.workflow_simulator_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wsr_admin_read ON public.workflow_simulator_runs;
CREATE POLICY wsr_admin_read ON public.workflow_simulator_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.workflow_simulator_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.workflow_simulator_runs(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  latency_ms integer,
  details jsonb DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wss_run ON public.workflow_simulator_steps (run_id, step_index);
GRANT SELECT ON public.workflow_simulator_steps TO authenticated;
GRANT ALL ON public.workflow_simulator_steps TO service_role;
ALTER TABLE public.workflow_simulator_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wss2_admin_read ON public.workflow_simulator_steps;
CREATE POLICY wss2_admin_read ON public.workflow_simulator_steps
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.workflow_simulator_scenarios (scenario_key, area, name, description) VALUES
  ('learner_journey', 'learner', 'Learner Journey E2E',
   'Profile → Course-Grant Check → Lesson-Pool → Minicheck-Pool → Exam-Pool → Readiness'),
  ('b2b_org_journey', 'b2b', 'B2B Org Journey E2E',
   'License-Health → Seats → Pending-Invites → Owner-Digest → Renewal-Links → Stripe-Events'),
  ('content_factory', 'content', 'Content Factory Pipeline',
   'Intake → Council-DAG → Quality-Gate → WIP-Packages → Quarantine → Job-Queue'),
  ('seo_distribution', 'seo', 'SEO + Distribution Pipeline',
   'Pages → IndexNow-Queue → Submission-Logs → Distribution-Runs → Bridge-Activations → Crawl-Policy')
ON CONFLICT (scenario_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_enqueue_workflow_simulator_run(
  p_scenario text, p_mode text DEFAULT 'smoke'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  IF p_mode NOT IN ('smoke','live') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_simulator_scenarios
                 WHERE scenario_key = p_scenario AND is_active) THEN
    RAISE EXCEPTION 'unknown or inactive scenario: %', p_scenario;
  END IF;
  INSERT INTO public.workflow_simulator_runs
    (scenario_key, mode, triggered_by, triggered_user, status)
  VALUES (p_scenario, p_mode, 'admin', v_uid, 'running')
  RETURNING id INTO v_run_id;
  RETURN v_run_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_enqueue_workflow_simulator_run(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_workflow_simulator_run(text,text) TO authenticated;

CREATE OR REPLACE VIEW public.v_workflow_simulator_overview AS
SELECT r.id, r.scenario_key, s.area, s.name AS scenario_name,
       r.mode, r.triggered_by, r.status,
       r.started_at, r.finished_at, r.duration_ms,
       r.total_steps, r.passed, r.failed, r.skipped, r.summary, r.error
FROM public.workflow_simulator_runs r
LEFT JOIN public.workflow_simulator_scenarios s ON s.scenario_key = r.scenario_key
ORDER BY r.started_at DESC;
GRANT SELECT ON public.v_workflow_simulator_overview TO authenticated;
GRANT SELECT ON public.v_workflow_simulator_overview TO service_role;
