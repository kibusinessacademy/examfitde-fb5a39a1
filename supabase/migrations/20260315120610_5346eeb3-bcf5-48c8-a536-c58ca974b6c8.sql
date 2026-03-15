
-- AI Generation Gateway Tables

-- 1. Central generation requests table
CREATE TABLE IF NOT EXISTS public.ai_generation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  source_table text,
  source_id uuid,
  source_ref jsonb,
  package_id uuid,
  course_id uuid,
  certification_id uuid,
  target_artifact text NOT NULL,
  urgency text NOT NULL DEFAULT 'async',
  quality_tier text NOT NULL DEFAULT 'standard',
  deficit_required boolean NOT NULL DEFAULT true,
  deficit_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  cache_key text,
  request_fingerprint text,
  routing_mode text NOT NULL DEFAULT 'batch',
  provider text,
  model text,
  status text NOT NULL DEFAULT 'queued',
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  llm_batch_id uuid REFERENCES public.llm_batches(id) ON DELETE SET NULL,
  llm_request_id uuid,
  retry_count int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_req_status ON public.ai_generation_requests(status);
CREATE INDEX IF NOT EXISTS idx_ai_gen_req_job_status ON public.ai_generation_requests(job_type, status);
CREATE INDEX IF NOT EXISTS idx_ai_gen_req_package ON public.ai_generation_requests(package_id);
CREATE INDEX IF NOT EXISTS idx_ai_gen_req_cache ON public.ai_generation_requests(cache_key);

-- 2. Response cache table
CREATE TABLE IF NOT EXISTS public.ai_generation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  job_type text NOT NULL,
  provider text,
  model text,
  request_fingerprint text NOT NULL,
  response_body jsonb NOT NULL,
  usage_data jsonb,
  cost_eur numeric(12,6),
  hit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_cache_job ON public.ai_generation_cache(job_type);

-- 3. Policies table (DB-driven governance)
CREATE TABLE IF NOT EXISTS public.ai_generation_policies (
  job_type text PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT true,
  prefer_batch boolean NOT NULL DEFAULT false,
  allow_sync boolean NOT NULL DEFAULT true,
  require_deficit boolean NOT NULL DEFAULT true,
  use_cache boolean NOT NULL DEFAULT true,
  template_first boolean NOT NULL DEFAULT false,
  max_retries int NOT NULL DEFAULT 1,
  max_tokens_out int,
  max_batch_size int,
  allowed_models text[] NOT NULL DEFAULT '{}',
  default_model text,
  daily_budget_eur numeric(10,2),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.ai_generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_policies ENABLE ROW LEVEL SECURITY;

-- Service role policies (backend-only tables)
CREATE POLICY "service_role_ai_gen_requests" ON public.ai_generation_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_ai_gen_cache" ON public.ai_generation_cache FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_ai_gen_policies" ON public.ai_generation_policies FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.trg_ai_gen_requests_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_gen_requests_updated
  BEFORE UPDATE ON public.ai_generation_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_ai_gen_requests_updated_at();
