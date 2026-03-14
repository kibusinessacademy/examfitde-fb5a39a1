
-- Add machine-readable stop_reason_code to autofix_runs
ALTER TABLE public.autofix_runs
  ADD COLUMN IF NOT EXISTS stop_reason_code text DEFAULT NULL;

-- Add baseline_snapshot to track starting conditions
ALTER TABLE public.autofix_runs
  ADD COLUMN IF NOT EXISTS baseline_snapshot jsonb DEFAULT NULL;

COMMENT ON COLUMN public.autofix_runs.stop_reason_code IS 'Machine-readable enum: STAGNATION, MAX_ROUNDS_EXCEEDED, INSUFFICIENT_BASELINE, BUDGET_EXHAUSTED, CIRCUIT_BREAKER, REGRESSION, MANUAL';
COMMENT ON COLUMN public.autofix_runs.baseline_snapshot IS 'Snapshot of metrics at autofix start for delta tracking: {questions, coverage_pct, score, oral, handbook_chapters}';
