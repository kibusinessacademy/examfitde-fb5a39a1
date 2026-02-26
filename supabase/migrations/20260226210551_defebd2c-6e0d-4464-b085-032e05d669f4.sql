-- Add phase-split and cursor/resume support to elite_hardening_runs
ALTER TABLE public.elite_hardening_runs
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS cursor_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS phase_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Unique index for idempotent phase runs
CREATE UNIQUE INDEX IF NOT EXISTS elite_runs_idem_uq
  ON public.elite_hardening_runs (package_id, phase, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for quick lookup of running runs per package+phase
CREATE INDEX IF NOT EXISTS elite_runs_pkg_phase_idx
  ON public.elite_hardening_runs (package_id, phase, status);