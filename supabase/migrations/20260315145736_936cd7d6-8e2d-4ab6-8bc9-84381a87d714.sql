ALTER TABLE public.ai_generation_policies
  ADD COLUMN IF NOT EXISTS batch_rollout_pct integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.ai_generation_policies.batch_rollout_pct IS 'Percentage of packages routed to batch (0-100). Uses hash(package_id) % 100 for deterministic canary rollout.';