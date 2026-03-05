CREATE TABLE IF NOT EXISTS public.llm_provider_cooldowns (
  provider text NOT NULL,
  model text NOT NULL,
  until_at timestamptz NOT NULL,
  reason text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model)
);

CREATE INDEX IF NOT EXISTS idx_llm_provider_cooldowns_until
ON public.llm_provider_cooldowns (until_at);

ALTER TABLE public.llm_provider_cooldowns ENABLE ROW LEVEL SECURITY;

-- Only service_role should access this table
CREATE POLICY "service_role_only" ON public.llm_provider_cooldowns
  FOR ALL TO service_role USING (true) WITH CHECK (true);