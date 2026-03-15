
-- OpenAI Batch backbone (provider-agnostic, OpenAI first)

CREATE TABLE IF NOT EXISTS public.llm_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('openai','anthropic')),
  job_type text NOT NULL,
  model text NOT NULL,
  endpoint text NOT NULL DEFAULT '/v1/chat/completions',
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft','uploading','uploaded','submitted','validating',
      'in_progress','finalizing','completed','failed','expired','cancelled'
    )
  ),
  completion_window text NOT NULL DEFAULT '24h',
  input_file_path text,
  input_file_id text,
  output_file_id text,
  error_file_id text,
  provider_batch_id text,
  provider_request_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_count int NOT NULL DEFAULT 0,
  completed_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  completed_at timestamptz,
  last_polled_at timestamptz,
  expires_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_batches_status ON public.llm_batches(status);
CREATE INDEX IF NOT EXISTS idx_llm_batches_provider_status ON public.llm_batches(provider, status);
CREATE INDEX IF NOT EXISTS idx_llm_batches_job_type_status ON public.llm_batches(job_type, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_batches_provider_batch_id
  ON public.llm_batches(provider, provider_batch_id)
  WHERE provider_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.llm_batch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.llm_batches(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','anthropic')),
  custom_id text NOT NULL,
  source_job_id uuid,
  source_table text,
  source_ref text,
  job_type text NOT NULL,
  model text NOT NULL,
  endpoint text NOT NULL DEFAULT '/v1/chat/completions',
  request_payload jsonb NOT NULL,
  request_hash text,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','submitted','completed','failed','expired','cancelled')
  ),
  response_http_status int,
  response_body jsonb,
  error_body jsonb,
  usage_data jsonb,
  tokens_in int,
  tokens_out int,
  cached_input_tokens int,
  total_tokens int,
  cost_usd numeric(12,6),
  cost_eur numeric(12,6),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_llm_batch_requests_custom UNIQUE(batch_id, custom_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_batch_requests_batch_id ON public.llm_batch_requests(batch_id);
CREATE INDEX IF NOT EXISTS idx_llm_batch_requests_status ON public.llm_batch_requests(status);
CREATE INDEX IF NOT EXISTS idx_llm_batch_requests_source_job_id ON public.llm_batch_requests(source_job_id);

-- Auto updated_at triggers
CREATE OR REPLACE FUNCTION public.tg_set_updated_at_llm_batches()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_llm_batches ON public.llm_batches;
CREATE TRIGGER trg_set_updated_at_llm_batches
BEFORE UPDATE ON public.llm_batches FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at_llm_batches();

CREATE OR REPLACE FUNCTION public.tg_set_updated_at_llm_batch_requests()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_llm_batch_requests ON public.llm_batch_requests;
CREATE TRIGGER trg_set_updated_at_llm_batch_requests
BEFORE UPDATE ON public.llm_batch_requests FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at_llm_batch_requests();

-- RLS: service_role only
ALTER TABLE public.llm_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_batch_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_llm_batches ON public.llm_batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_role_all_llm_batch_requests ON public.llm_batch_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Overview view
CREATE OR REPLACE VIEW public.v_llm_batch_overview AS
SELECT
  b.id, b.provider, b.job_type, b.model, b.status,
  b.request_count, b.completed_count, b.failed_count,
  b.provider_batch_id, b.input_file_id, b.output_file_id, b.error_file_id,
  b.submitted_at, b.completed_at, b.last_polled_at, b.created_at, b.updated_at
FROM public.llm_batches b;
