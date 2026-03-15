
-- Anthropic Batch API integration table
-- Tracks batch submissions, individual requests, and results

CREATE TABLE public.anthropic_batch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Anthropic batch tracking
  batch_id text,                          -- Anthropic's batch ID (msgbatch_xxx)
  custom_id text NOT NULL,                -- Our correlation ID (job_queue.id or composite key)
  
  -- Link back to pipeline
  job_id uuid,                            -- Original job_queue.id
  job_type text NOT NULL,                 -- e.g. package_generate_lesson_minichecks
  package_id uuid,
  
  -- Request params (stored for replay/debugging)
  request_params jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Full Anthropic message params
  
  -- Status tracking
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
  
  -- Result storage
  result_content text,                    -- The AI response text
  result_usage jsonb,                     -- Token usage from Anthropic
  result_stop_reason text,
  error_message text,
  
  -- Cost tracking
  cost_eur numeric(10, 6) DEFAULT 0,
  tokens_in integer DEFAULT 0,
  tokens_out integer DEFAULT 0,
  cache_read_input_tokens integer DEFAULT 0,
  cache_creation_input_tokens integer DEFAULT 0,
  
  -- Metadata
  model text NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  intent text,                            -- Pipeline intent for routing
  priority integer DEFAULT 5,             -- Higher = process sooner
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,               -- When included in a batch submission
  completed_at timestamptz,
  expires_at timestamptz,                 -- Anthropic batch expiry (24h)
  
  -- Indexes for efficient queries
  CONSTRAINT unique_custom_id UNIQUE (custom_id)
);

-- Index for batch polling
CREATE INDEX idx_abr_batch_id ON public.anthropic_batch_requests(batch_id) WHERE batch_id IS NOT NULL;
-- Index for collecting pending items
CREATE INDEX idx_abr_pending ON public.anthropic_batch_requests(status, priority DESC, created_at ASC) WHERE status = 'pending';
-- Index for job correlation
CREATE INDEX idx_abr_job_id ON public.anthropic_batch_requests(job_id) WHERE job_id IS NOT NULL;
-- Index for package correlation
CREATE INDEX idx_abr_package_id ON public.anthropic_batch_requests(package_id) WHERE package_id IS NOT NULL;

-- Batch submission tracking (groups of requests)
CREATE TABLE public.anthropic_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL UNIQUE,          -- Anthropic's batch ID
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_progress', 'ended', 'failed', 'expired', 'cancelled')),
  request_count integer NOT NULL DEFAULT 0,
  completed_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  
  -- Cost summary
  total_cost_eur numeric(10, 6) DEFAULT 0,
  total_tokens_in integer DEFAULT 0,
  total_tokens_out integer DEFAULT 0,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  expires_at timestamptz,                 -- Anthropic guarantees 24h
  
  -- Meta
  model text NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  meta jsonb DEFAULT '{}'::jsonb
);

-- RLS: service-role only (edge functions)
ALTER TABLE public.anthropic_batch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anthropic_batches ENABLE ROW LEVEL SECURITY;

-- No public access — only service_role can read/write
-- (Edge functions use service_role key)
