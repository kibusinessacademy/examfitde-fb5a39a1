
ALTER TABLE public.test_runs DROP CONSTRAINT IF EXISTS test_runs_suite_check;
ALTER TABLE public.test_runs ADD CONSTRAINT test_runs_suite_check 
  CHECK (suite IN ('smoke', 'sanity', 'uat', 'full', 'schema'));
