
-- Lease table for preventing parallel orchestrator runs
CREATE TABLE IF NOT EXISTS public.orchestrator_leases (
  function_name text PRIMARY KEY,
  locked_at timestamptz,
  locked_by text,
  expires_at timestamptz
);

-- Seed the orchestrator lease row
INSERT INTO public.orchestrator_leases (function_name, locked_at, locked_by, expires_at)
VALUES ('product-orchestrator', NULL, NULL, NULL)
ON CONFLICT DO NOTHING;

-- RLS: only service role needs access
ALTER TABLE public.orchestrator_leases ENABLE ROW LEVEL SECURITY;
