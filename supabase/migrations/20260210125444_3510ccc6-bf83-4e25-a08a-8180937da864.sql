-- Add severity column to risk_scores (required by Early Warning Engine + UI)
ALTER TABLE public.risk_scores
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'low';

-- Add check constraint separately to avoid issues with IF NOT EXISTS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'risk_scores_severity_check'
  ) THEN
    ALTER TABLE public.risk_scores
      ADD CONSTRAINT risk_scores_severity_check
      CHECK (severity IN ('low', 'medium', 'high', 'critical'));
  END IF;
END $$;