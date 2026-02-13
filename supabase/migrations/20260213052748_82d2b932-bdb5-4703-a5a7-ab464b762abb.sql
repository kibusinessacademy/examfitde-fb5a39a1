
-- ============================================
-- LLM Load Controller: Rate Limits Config
-- ============================================
CREATE TABLE IF NOT EXISTS public.llm_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  max_concurrent integer NOT NULL DEFAULT 2,
  max_rpm integer,
  max_tpm integer,
  cooldown_seconds integer NOT NULL DEFAULT 120,
  is_paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_only_llm_rate_limits" ON public.llm_rate_limits
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed defaults
INSERT INTO public.llm_rate_limits (provider, max_concurrent, cooldown_seconds)
VALUES 
  ('openai', 2, 120),
  ('google', 3, 90),
  ('anthropic', 2, 120)
ON CONFLICT (provider) DO NOTHING;

-- ============================================
-- LLM Budget Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.llm_budget (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL DEFAULT 'monthly',
  month text NOT NULL DEFAULT to_char(now(), 'YYYY-MM'),
  budget_eur numeric NOT NULL DEFAULT 200,
  spent_eur numeric NOT NULL DEFAULT 0,
  hard_stop boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(period, month)
);

ALTER TABLE public.llm_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_only_llm_budget" ON public.llm_budget
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed current month
INSERT INTO public.llm_budget (period, month, budget_eur)
VALUES ('monthly', to_char(now(), 'YYYY-MM'), 200)
ON CONFLICT (period, month) DO NOTHING;

-- ============================================
-- Extend job_queue with Load Controller columns
-- ============================================
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS last_http_status integer,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_hint text,
  ADD COLUMN IF NOT EXISTS rate_limited_until timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_tokens integer,
  ADD COLUMN IF NOT EXISTS cost_estimate_eur numeric,
  ADD COLUMN IF NOT EXISTS batch_cursor jsonb,
  ADD COLUMN IF NOT EXISTS parent_job_id uuid;

-- Index for scheduled job picking
CREATE INDEX IF NOT EXISTS idx_job_queue_scheduled
  ON public.job_queue (status, scheduled_at NULLS FIRST, priority, created_at)
  WHERE status = 'pending';

-- Index for provider concurrency counting
CREATE INDEX IF NOT EXISTS idx_job_queue_provider_running
  ON public.job_queue (provider, status)
  WHERE status = 'processing' AND provider IS NOT NULL;

-- ============================================
-- Helper function: count running LLM jobs per provider
-- ============================================
CREATE OR REPLACE FUNCTION public.llm_running_count(p_provider text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM job_queue
  WHERE status = 'processing'
    AND provider = p_provider;
$$;

-- ============================================
-- Helper function: check if LLM job can run
-- ============================================
CREATE OR REPLACE FUNCTION public.can_run_llm_job(p_provider text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM llm_rate_limits
      WHERE provider = p_provider AND is_paused = true
    ) THEN false
    WHEN (
      SELECT llm_running_count(p_provider)
    ) >= COALESCE(
      (SELECT max_concurrent FROM llm_rate_limits WHERE provider = p_provider),
      2
    ) THEN false
    ELSE true
  END;
$$;
