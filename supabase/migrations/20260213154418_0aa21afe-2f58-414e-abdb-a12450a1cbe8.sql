
-- Drop conflicting functions first
DROP FUNCTION IF EXISTS public.mark_provider_rate_limited(text, integer, text);
DROP FUNCTION IF EXISTS public.select_best_provider(text, text[]);
DROP FUNCTION IF EXISTS public.recover_providers();

-- ═══════════════════════════════════════════════════════════════════
-- PROVIDER AUTOPILOT v2: Adaptive Routing, Batch Queue, Predictive Backpressure
-- ═══════════════════════════════════════════════════════════════════

-- 1) Extend provider_status with scoring & history columns
ALTER TABLE public.provider_status
  ADD COLUMN IF NOT EXISTS total_success_24h integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_errors_24h integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_latency_ms integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_1k_tokens numeric(8,5) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reliability_score numeric(5,2) DEFAULT 100,
  ADD COLUMN IF NOT EXISTS routing_score numeric(5,2) DEFAULT 100,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_base_seconds integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS cooldown_multiplier integer DEFAULT 1;

-- 2) Intent-based routing
CREATE TABLE IF NOT EXISTS public.provider_job_affinity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  preferred_provider text NOT NULL,
  reason text,
  weight numeric(3,2) DEFAULT 1.0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(job_type, preferred_provider)
);
ALTER TABLE public.provider_job_affinity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on provider_job_affinity" ON public.provider_job_affinity FOR ALL USING (true);

INSERT INTO public.provider_job_affinity (job_type, preferred_provider, reason, weight) VALUES
  ('generate_curriculum_content', 'openai', 'Structure parsing', 1.0),
  ('package_generate_exam_pool', 'openai', 'Batch generation', 1.0),
  ('package_generate_handbook', 'anthropic', 'Long-form content', 1.0),
  ('package_generate_oral_exam', 'anthropic', 'Conversational quality', 1.0),
  ('improve_lesson', 'anthropic', 'Content refinement', 1.0),
  ('seo_generate', 'google', 'Fast short calls', 0.8),
  ('seo_content_batch', 'google', 'Parallel batch', 0.8),
  ('auto_gap_close', 'openai', 'Complex reasoning', 1.0),
  ('seed_exam_questions', 'openai', 'Structured output', 1.0),
  ('council_propose_step', 'anthropic', 'Creative proposals', 0.9),
  ('council_critique_step', 'openai', 'Analytical critique', 0.9)
ON CONFLICT DO NOTHING;

-- 3) Provider usage history
CREATE TABLE IF NOT EXISTS public.provider_usage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  job_type text NOT NULL,
  success boolean NOT NULL,
  latency_ms integer,
  tokens_used integer DEFAULT 0,
  cost_eur numeric(8,4) DEFAULT 0,
  error_category text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.provider_usage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on provider_usage_history" ON public.provider_usage_history FOR ALL USING (true);
CREATE INDEX IF NOT EXISTS idx_puh_provider_created ON public.provider_usage_history (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puh_created ON public.provider_usage_history (created_at DESC);

-- 4) Backpressure snapshots
CREATE TABLE IF NOT EXISTS public.backpressure_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_count integer NOT NULL,
  processing_count integer NOT NULL,
  completed_1h integer DEFAULT 0,
  failed_1h integer DEFAULT 0,
  throughput_per_min numeric(6,2) DEFAULT 0,
  eta_clear_minutes numeric(8,1) DEFAULT 0,
  forecast_trend text DEFAULT 'stable',
  throttle_active boolean DEFAULT false,
  snapshot_at timestamptz DEFAULT now()
);
ALTER TABLE public.backpressure_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on backpressure_snapshots" ON public.backpressure_snapshots FOR ALL USING (true);

-- 5) Enhanced select_best_provider with routing score + intent affinity
CREATE OR REPLACE FUNCTION public.select_best_provider(
  p_preferred text DEFAULT NULL,
  p_exclude text[] DEFAULT ARRAY[]::text[],
  p_job_type text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
  v_affinity_provider text;
BEGIN
  IF p_job_type IS NOT NULL THEN
    SELECT pja.preferred_provider INTO v_affinity_provider
    FROM provider_job_affinity pja
    JOIN provider_status ps ON ps.provider = pja.preferred_provider
    WHERE pja.job_type = p_job_type
      AND ps.is_healthy = true
      AND ps.current_load < ps.max_concurrency
      AND (ps.rate_limited_until IS NULL OR ps.rate_limited_until < now())
      AND pja.preferred_provider != ALL(p_exclude)
    ORDER BY pja.weight DESC
    LIMIT 1;
    IF v_affinity_provider IS NOT NULL THEN RETURN v_affinity_provider; END IF;
  END IF;

  IF p_preferred IS NOT NULL AND p_preferred != 'auto' THEN
    SELECT provider INTO v_provider FROM provider_status
    WHERE provider = p_preferred AND is_healthy = true
      AND current_load < max_concurrency
      AND (rate_limited_until IS NULL OR rate_limited_until < now())
      AND provider != ALL(p_exclude);
    IF v_provider IS NOT NULL THEN RETURN v_provider; END IF;
  END IF;

  SELECT provider INTO v_provider FROM provider_status
  WHERE is_healthy = true AND current_load < max_concurrency
    AND (rate_limited_until IS NULL OR rate_limited_until < now())
    AND provider != ALL(p_exclude)
  ORDER BY routing_score DESC, priority ASC, current_load ASC
  LIMIT 1;

  RETURN v_provider;
END;
$$;

-- 6) Exponential cooldown
CREATE OR REPLACE FUNCTION public.mark_provider_rate_limited(
  p_provider text,
  p_cooldown_seconds integer,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_multiplier integer;
  v_base integer;
  v_effective_cooldown integer;
BEGIN
  SELECT COALESCE(cooldown_multiplier, 1), COALESCE(cooldown_base_seconds, 60)
  INTO v_multiplier, v_base FROM provider_status WHERE provider = p_provider;

  v_effective_cooldown := LEAST(v_base * power(2, v_multiplier - 1)::integer, 600);

  UPDATE provider_status SET
    is_healthy = false,
    rate_limited_until = now() + (v_effective_cooldown || ' seconds')::interval,
    last_error = p_error,
    consecutive_failures = consecutive_failures + 1,
    cooldown_multiplier = LEAST(COALESCE(v_multiplier, 1) + 1, 5),
    total_errors_24h = total_errors_24h + 1,
    updated_at = now()
  WHERE provider = p_provider;
END;
$$;

-- 7) Recover with cooldown reset
CREATE OR REPLACE FUNCTION public.recover_providers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE provider_status SET
    is_healthy = true, rate_limited_until = NULL,
    cooldown_multiplier = 1, consecutive_failures = 0, updated_at = now()
  WHERE is_healthy = false AND rate_limited_until IS NOT NULL AND rate_limited_until < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 8) Recalculate routing scores
CREATE OR REPLACE FUNCTION public.recalculate_routing_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_reliability numeric;
  v_avg_lat numeric;
  v_cost_score numeric;
  v_load_score numeric;
  v_total numeric;
  v_success_count integer;
  v_error_count integer;
BEGIN
  FOR r IN SELECT provider, max_concurrency, current_load, cost_per_1k_tokens FROM provider_status LOOP
    SELECT
      CASE WHEN COUNT(*) = 0 THEN 100 ELSE (COUNT(*) FILTER (WHERE success) * 100.0 / COUNT(*)) END,
      COALESCE(AVG(latency_ms) FILTER (WHERE success), 0),
      COALESCE(COUNT(*) FILTER (WHERE success), 0),
      COALESCE(COUNT(*) FILTER (WHERE NOT success), 0)
    INTO v_reliability, v_avg_lat, v_success_count, v_error_count
    FROM provider_usage_history
    WHERE provider = r.provider AND created_at > now() - interval '24 hours';

    v_avg_lat := GREATEST(0, 100 - (v_avg_lat / 300.0));
    v_cost_score := GREATEST(0, 100 - (COALESCE(r.cost_per_1k_tokens, 0) * 1000));
    v_load_score := CASE WHEN r.max_concurrency = 0 THEN 0
      ELSE GREATEST(0, 100 - (r.current_load * 100.0 / r.max_concurrency)) END;
    v_total := (v_reliability * 0.4) + (v_avg_lat * 0.3) + (v_cost_score * 0.2) + (v_load_score * 0.1);

    UPDATE provider_status SET
      reliability_score = ROUND(v_reliability, 2),
      routing_score = ROUND(v_total, 2),
      avg_latency_ms = v_avg_lat::integer,
      total_success_24h = v_success_count,
      total_errors_24h = v_error_count,
      updated_at = now()
    WHERE provider = r.provider;
  END LOOP;
END;
$$;

-- 9) Log provider usage helper
CREATE OR REPLACE FUNCTION public.log_provider_usage(
  p_provider text,
  p_job_type text,
  p_success boolean,
  p_latency_ms integer DEFAULT NULL,
  p_tokens integer DEFAULT 0,
  p_cost numeric DEFAULT 0,
  p_error_category text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO provider_usage_history (provider, job_type, success, latency_ms, tokens_used, cost_eur, error_category)
  VALUES (p_provider, p_job_type, p_success, p_latency_ms, p_tokens, p_cost, p_error_category);

  IF p_success THEN
    UPDATE provider_status SET consecutive_failures = 0, cooldown_multiplier = 1, updated_at = now()
    WHERE provider = p_provider;
  END IF;
END;
$$;

-- 10) Cleanup old history
CREATE OR REPLACE FUNCTION public.cleanup_provider_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM provider_usage_history WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM backpressure_snapshots WHERE snapshot_at < now() - interval '3 days';
  RETURN v_count;
END;
$$;
