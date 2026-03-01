
-- Add exception approval columns to package_steps
ALTER TABLE public.package_steps
  ADD COLUMN IF NOT EXISTS exception_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exception_reason text,
  ADD COLUMN IF NOT EXISTS exception_approved_by text,
  ADD COLUMN IF NOT EXISTS exception_approved_at timestamptz;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_package_steps_exception
  ON public.package_steps (package_id)
  WHERE exception_approved = true;

COMMENT ON COLUMN public.package_steps.exception_approved IS 'Admin override: treat step as done despite failures';
COMMENT ON COLUMN public.package_steps.exception_reason IS 'Reason for the exception approval';
