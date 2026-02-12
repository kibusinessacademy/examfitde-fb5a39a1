
-- Auto-Gap-Closer state tracking
CREATE TABLE IF NOT EXISTS public.autofix_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  course_id uuid,
  target_score int NOT NULL DEFAULT 85,
  max_rounds int NOT NULL DEFAULT 3,
  current_round int NOT NULL DEFAULT 0,
  budget_eur numeric(10,2) NOT NULL DEFAULT 2.00,
  budget_used_eur numeric(10,2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'running',
  last_score int,
  last_report jsonb,
  last_plan jsonb,
  stop_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autofix_runs_package ON public.autofix_runs(package_id);
CREATE INDEX IF NOT EXISTS idx_autofix_runs_status ON public.autofix_runs(status);

-- RLS
ALTER TABLE public.autofix_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on autofix_runs"
  ON public.autofix_runs FOR ALL
  USING (true) WITH CHECK (true);

-- Add validation trigger
CREATE OR REPLACE FUNCTION public.validate_autofix_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status NOT IN ('running','paused','stopped','succeeded','failed') THEN
    RAISE EXCEPTION 'Invalid autofix status: %', NEW.status;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_autofix_status
  BEFORE INSERT OR UPDATE ON public.autofix_runs
  FOR EACH ROW EXECUTE FUNCTION public.validate_autofix_status();
