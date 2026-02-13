-- Mass Production Mode: Add max_retries column first
ALTER TABLE public.llm_rate_limits ADD COLUMN IF NOT EXISTS max_retries int NOT NULL DEFAULT 25;

-- Concurrency + Rate Limits hochfahren
UPDATE public.llm_rate_limits SET max_concurrent = 8, cooldown_seconds = 60, max_retries = 25 WHERE provider = 'openai';
UPDATE public.llm_rate_limits SET max_concurrent = 6, cooldown_seconds = 65, max_retries = 25 WHERE provider = 'anthropic';
UPDATE public.llm_rate_limits SET max_concurrent = 5, cooldown_seconds = 65, max_retries = 25 WHERE provider = 'google';

-- Budget: Completion-First (max 4 active)
UPDATE public.llm_budget SET max_active_packages = 4 WHERE max_active_packages IS NOT NULL;

-- Job-Queue Default max_attempts auf 25
ALTER TABLE public.job_queue ALTER COLUMN max_attempts SET DEFAULT 25;