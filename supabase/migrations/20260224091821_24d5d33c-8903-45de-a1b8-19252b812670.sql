
ALTER TABLE public.test_runs DROP CONSTRAINT test_runs_suite_check;
ALTER TABLE public.test_runs ADD CONSTRAINT test_runs_suite_check CHECK (suite = ANY (ARRAY['smoke', 'sanity', 'uat', 'full']));
