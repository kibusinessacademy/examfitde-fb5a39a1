
ALTER TABLE public.test_runs DROP CONSTRAINT test_runs_trigger_source_check;
ALTER TABLE public.test_runs ADD CONSTRAINT test_runs_trigger_source_check CHECK (trigger_source = ANY (ARRAY['manual', 'deploy', 'scheduled', 'ci', 'dashboard', 'cron_nightly', 'manual_agent', 'verification']));
