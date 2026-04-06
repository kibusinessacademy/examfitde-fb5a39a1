
ALTER TABLE public.llm_provider_cooldowns
  ADD COLUMN job_type text NOT NULL DEFAULT '__global__';

ALTER TABLE public.llm_provider_cooldowns
  DROP CONSTRAINT llm_provider_cooldowns_pkey;

ALTER TABLE public.llm_provider_cooldowns
  ADD PRIMARY KEY (provider, model, job_type);
