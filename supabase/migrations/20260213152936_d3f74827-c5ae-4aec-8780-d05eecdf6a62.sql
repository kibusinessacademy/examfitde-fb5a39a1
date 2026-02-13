
-- ═══════════════════════════════════════════════════════════════
-- Provider Status Registry – Dynamic Health Routing
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.provider_status (
  provider TEXT PRIMARY KEY,
  is_healthy BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limited_until TIMESTAMPTZ,
  current_load INT NOT NULL DEFAULT 0,
  max_concurrency INT NOT NULL DEFAULT 5,
  priority INT NOT NULL DEFAULT 10,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  total_jobs_24h INT NOT NULL DEFAULT 0,
  total_errors_24h INT NOT NULL DEFAULT 0,
  avg_latency_ms INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_status ENABLE ROW LEVEL SECURITY;

-- Admin-only read (service role bypasses RLS)
CREATE POLICY "Service role full access on provider_status"
  ON public.provider_status FOR ALL
  USING (true) WITH CHECK (true);

-- Seed initial provider data
INSERT INTO public.provider_status (provider, is_healthy, max_concurrency, priority, current_load)
VALUES
  ('openai',    true, 8, 1, 0),
  ('anthropic', true, 6, 2, 0),
  ('google',    true, 5, 3, 0)
ON CONFLICT (provider) DO UPDATE SET
  max_concurrency = EXCLUDED.max_concurrency,
  priority = EXCLUDED.priority;

-- ═══════════════════════════════════════════════════════════════
-- Function: select_best_provider – called by job-runner
-- Returns the best available provider or NULL if all blocked
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.select_best_provider(
  p_preferred TEXT DEFAULT NULL,
  p_exclude TEXT[] DEFAULT '{}'
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_provider TEXT;
BEGIN
  -- If preferred is healthy and has capacity, use it
  IF p_preferred IS NOT NULL THEN
    SELECT provider INTO v_provider
    FROM provider_status
    WHERE provider = p_preferred
      AND is_healthy = true
      AND current_load < max_concurrency
      AND (rate_limited_until IS NULL OR rate_limited_until < now())
      AND provider != ALL(p_exclude);
    
    IF v_provider IS NOT NULL THEN
      RETURN v_provider;
    END IF;
  END IF;

  -- Otherwise pick best available by priority
  SELECT provider INTO v_provider
  FROM provider_status
  WHERE is_healthy = true
    AND current_load < max_concurrency
    AND (rate_limited_until IS NULL OR rate_limited_until < now())
    AND provider != ALL(p_exclude)
  ORDER BY priority ASC, current_load ASC
  LIMIT 1;

  RETURN v_provider;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Function: claim_provider_slot – atomically increment load
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_provider_slot(p_provider TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_claimed BOOLEAN := false;
BEGIN
  UPDATE provider_status
  SET current_load = current_load + 1,
      updated_at = now()
  WHERE provider = p_provider
    AND current_load < max_concurrency
    AND is_healthy = true
    AND (rate_limited_until IS NULL OR rate_limited_until < now());
  
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed > 0;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Function: release_provider_slot – atomically decrement load
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.release_provider_slot(p_provider TEXT)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE provider_status
  SET current_load = GREATEST(current_load - 1, 0),
      updated_at = now()
  WHERE provider = p_provider;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Function: mark_provider_rate_limited
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mark_provider_rate_limited(
  p_provider TEXT,
  p_cooldown_seconds INT DEFAULT 120,
  p_error TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE provider_status
  SET is_healthy = false,
      rate_limited_until = now() + (p_cooldown_seconds || ' seconds')::interval,
      last_error = COALESCE(p_error, 'Rate limited'),
      last_error_at = now(),
      total_errors_24h = total_errors_24h + 1,
      updated_at = now()
  WHERE provider = p_provider;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Function: auto-recover providers past their cooldown
-- Called periodically or at start of job-runner
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recover_providers()
RETURNS INT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE provider_status
  SET is_healthy = true,
      rate_limited_until = NULL,
      updated_at = now()
  WHERE is_healthy = false
    AND rate_limited_until IS NOT NULL
    AND rate_limited_until < now();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Fix stuck Google jobs → set provider to 'auto'
-- ═══════════════════════════════════════════════════════════════

UPDATE public.job_queue
SET provider = 'auto',
    updated_at = now()
WHERE status = 'pending'
  AND provider = 'google';
