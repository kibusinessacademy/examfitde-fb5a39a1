-- ============================================
-- AI Worker Governance (Production-Grade)
-- ============================================

-- Drop existing functions to allow signature changes
DROP FUNCTION IF EXISTS public.claim_next_job(text, text[], integer);
DROP FUNCTION IF EXISTS public.complete_job(uuid, json);
DROP FUNCTION IF EXISTS public.fail_job(uuid, text, boolean);

-- 1️⃣ Worker Policies Table (SSOT for all worker rules)
CREATE TABLE IF NOT EXISTS public.ai_worker_policies (
  job_type text PRIMARY KEY,
  max_parallel integer NOT NULL DEFAULT 3,
  max_attempts integer NOT NULL DEFAULT 3,
  timeout_seconds integer NOT NULL DEFAULT 300,
  max_tokens_per_run integer NOT NULL DEFAULT 100000,
  max_cost_eur_per_day numeric(10,4) NOT NULL DEFAULT 10.0000,
  pause_on_error_rate numeric(3,2) NOT NULL DEFAULT 0.20,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_worker_policies ENABLE ROW LEVEL SECURITY;

-- Admin-only policy
DO $$ BEGIN
  CREATE POLICY "Admins can manage worker policies"
    ON public.ai_worker_policies
    FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2️⃣ Daily Usage Tracking
CREATE TABLE IF NOT EXISTS public.ai_worker_usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  runs integer NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0,
  cost_eur numeric(10,4) NOT NULL DEFAULT 0.0000,
  errors integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_type, date)
);

-- Enable RLS
ALTER TABLE public.ai_worker_usage_daily ENABLE ROW LEVEL SECURITY;

-- Admin-only policy
DO $$ BEGIN
  CREATE POLICY "Admins can manage usage data"
    ON public.ai_worker_usage_daily
    FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ai_worker_usage_daily_lookup 
  ON public.ai_worker_usage_daily(job_type, date);

-- 3️⃣ Health View (combines policies + usage)
CREATE OR REPLACE VIEW public.ai_worker_health
WITH (security_invoker = true)
AS
SELECT 
  p.job_type,
  p.enabled,
  p.max_parallel,
  p.max_attempts,
  p.timeout_seconds,
  p.max_tokens_per_run,
  p.max_cost_eur_per_day,
  p.pause_on_error_rate,
  COALESCE(u.runs, 0) AS runs_today,
  COALESCE(u.errors, 0) AS errors_today,
  COALESCE(u.tokens_used, 0) AS tokens_today,
  COALESCE(u.cost_eur, 0) AS cost_today,
  CASE 
    WHEN COALESCE(u.runs, 0) > 0 
    THEN ROUND(COALESCE(u.errors, 0)::numeric / u.runs, 2)
    ELSE 0
  END AS error_rate,
  CASE
    WHEN NOT p.enabled THEN 'disabled'
    WHEN COALESCE(u.cost_eur, 0) >= p.max_cost_eur_per_day THEN 'paused_budget'
    WHEN COALESCE(u.runs, 0) > 0 
      AND (COALESCE(u.errors, 0)::numeric / u.runs) >= p.pause_on_error_rate 
    THEN 'paused_error_rate'
    ELSE 'active'
  END AS status,
  p.updated_at AS policy_updated_at
FROM public.ai_worker_policies p
LEFT JOIN public.ai_worker_usage_daily u 
  ON u.job_type = p.job_type 
  AND u.date = CURRENT_DATE;

-- 4️⃣ Function to check if worker can claim jobs
CREATE OR REPLACE FUNCTION public.can_worker_claim(p_job_type text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy ai_worker_policies%ROWTYPE;
  v_usage ai_worker_usage_daily%ROWTYPE;
  v_active_count integer;
BEGIN
  -- Get policy
  SELECT * INTO v_policy
  FROM ai_worker_policies
  WHERE job_type = p_job_type;
  
  -- No policy = allow claim (backwards compatible)
  IF NOT FOUND THEN
    RETURN true;
  END IF;
  
  -- Check if enabled
  IF NOT v_policy.enabled THEN
    RETURN false;
  END IF;
  
  -- Get today's usage
  SELECT * INTO v_usage
  FROM ai_worker_usage_daily
  WHERE job_type = p_job_type
    AND date = CURRENT_DATE;
  
  -- Check budget (if usage exists)
  IF FOUND AND v_usage.cost_eur >= v_policy.max_cost_eur_per_day THEN
    RETURN false;
  END IF;
  
  -- Check error rate (only if > 5 runs to avoid false positives)
  IF FOUND AND v_usage.runs >= 5 AND 
     (v_usage.errors::numeric / v_usage.runs) >= v_policy.pause_on_error_rate THEN
    RETURN false;
  END IF;
  
  -- Check parallel limit
  SELECT COUNT(*) INTO v_active_count
  FROM job_queue
  WHERE job_type = p_job_type
    AND status = 'processing';
  
  IF v_active_count >= v_policy.max_parallel THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$;

-- 5️⃣ Function to record usage (called after job completion)
CREATE OR REPLACE FUNCTION public.record_worker_usage(
  p_job_type text,
  p_tokens_used integer DEFAULT 0,
  p_cost_eur numeric DEFAULT 0,
  p_is_error boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_worker_usage_daily (job_type, date, runs, tokens_used, cost_eur, errors)
  VALUES (
    p_job_type, 
    CURRENT_DATE, 
    1, 
    p_tokens_used, 
    p_cost_eur, 
    CASE WHEN p_is_error THEN 1 ELSE 0 END
  )
  ON CONFLICT (job_type, date) 
  DO UPDATE SET
    runs = ai_worker_usage_daily.runs + 1,
    tokens_used = ai_worker_usage_daily.tokens_used + EXCLUDED.tokens_used,
    cost_eur = ai_worker_usage_daily.cost_eur + EXCLUDED.cost_eur,
    errors = ai_worker_usage_daily.errors + EXCLUDED.errors,
    updated_at = now();
END;
$$;

-- 6️⃣ Update claim_next_job to respect governance
CREATE OR REPLACE FUNCTION public.claim_next_job(
  p_worker_id text,
  p_job_types text[] DEFAULT NULL,
  p_lock_timeout_minutes integer DEFAULT 10
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job job_queue%ROWTYPE;
  v_result json;
BEGIN
  -- Find and lock the next available job
  SELECT * INTO v_job
  FROM job_queue
  WHERE status = 'pending'
    AND (run_after IS NULL OR run_after <= now())
    AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
    -- Governance check: only claim if worker is allowed
    AND public.can_worker_claim(job_type)
  ORDER BY priority ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Validate payload against SSOT rules
  BEGIN
    PERFORM public.assert_job_payload(to_json(v_job));
  EXCEPTION WHEN OTHERS THEN
    -- Mark as failed with SSOT violation
    UPDATE job_queue
    SET status = 'failed',
        last_error = 'SSOT VIOLATION: ' || SQLERRM,
        updated_at = now()
    WHERE id = v_job.id;
    
    -- Record as error
    PERFORM public.record_worker_usage(v_job.job_type, 0, 0, true);
    
    RETURN NULL;
  END;
  
  -- Claim the job
  UPDATE job_queue
  SET status = 'processing',
      started_at = now(),
      locked_at = now(),
      locked_by = p_worker_id,
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  
  -- Return job as JSON
  SELECT json_build_object(
    'id', v_job.id,
    'job_type', v_job.job_type,
    'payload', v_job.payload,
    'attempts', v_job.attempts,
    'max_attempts', v_job.max_attempts
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

-- 7️⃣ Update complete_job to record usage
CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id uuid,
  p_result json DEFAULT NULL,
  p_tokens_used integer DEFAULT 0,
  p_cost_eur numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_type text;
BEGIN
  -- Get job type before completing
  SELECT job_type INTO v_job_type
  FROM job_queue
  WHERE id = p_job_id;
  
  -- Complete the job
  UPDATE job_queue
  SET status = 'completed',
      completed_at = now(),
      result = p_result,
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE id = p_job_id;
  
  -- Record successful usage
  IF v_job_type IS NOT NULL THEN
    PERFORM public.record_worker_usage(v_job_type, p_tokens_used, p_cost_eur, false);
  END IF;
END;
$$;

-- 8️⃣ Update fail_job to record usage
CREATE OR REPLACE FUNCTION public.fail_job(
  p_job_id uuid,
  p_error text,
  p_allow_retry boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job job_queue%ROWTYPE;
  v_error_class text;
BEGIN
  SELECT * INTO v_job FROM job_queue WHERE id = p_job_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Classify error
  v_error_class := public.classify_job_error(p_error);
  
  -- Record as error
  PERFORM public.record_worker_usage(v_job.job_type, 0, 0, true);
  
  -- Check if retry is allowed
  IF p_allow_retry 
     AND v_error_class = 'technical' 
     AND v_job.attempts < v_job.max_attempts THEN
    -- Schedule retry
    UPDATE job_queue
    SET status = 'pending',
        last_error = p_error,
        run_after = now() + interval '1 minute' * v_job.attempts,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = p_job_id;
  ELSE
    -- Mark as failed
    UPDATE job_queue
    SET status = 'failed',
        last_error = p_error,
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = p_job_id;
  END IF;
END;
$$;

-- 9️⃣ Seed default policies for existing job types
INSERT INTO public.ai_worker_policies (job_type, max_parallel, max_attempts, timeout_seconds, max_tokens_per_run, max_cost_eur_per_day, pause_on_error_rate)
VALUES 
  ('extract_curriculum', 2, 3, 600, 150000, 20.0000, 0.30),
  ('generate_course', 2, 3, 900, 200000, 50.0000, 0.25),
  ('generate_questions', 3, 3, 300, 50000, 15.0000, 0.20),
  ('enrich_exam_solutions', 3, 3, 300, 50000, 10.0000, 0.20)
ON CONFLICT (job_type) DO NOTHING;