
-- Dead-Letter Queue for failed exam generation jobs
CREATE TABLE public.exam_pool_dlq (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blueprint_id uuid,
  job_id uuid,
  package_id uuid,
  provider text,
  model text,
  error_type text NOT NULL,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0,
  prompt_hash text,
  original_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for dashboard queries
CREATE INDEX idx_exam_pool_dlq_created ON public.exam_pool_dlq (created_at DESC);
CREATE INDEX idx_exam_pool_dlq_package ON public.exam_pool_dlq (package_id);

-- Enable RLS
ALTER TABLE public.exam_pool_dlq ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admin read DLQ" ON public.exam_pool_dlq FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service insert DLQ" ON public.exam_pool_dlq FOR INSERT
  WITH CHECK (true);

-- Concurrency snapshots for adaptive controller
CREATE TABLE public.concurrency_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  timeouts_5min integer NOT NULL DEFAULT 0,
  rate_limits_5min integer NOT NULL DEFAULT 0,
  escalations_5min integer NOT NULL DEFAULT 0,
  dlq_count_5min integer NOT NULL DEFAULT 0,
  jobs_per_min numeric,
  median_latency_ms integer,
  active_concurrency integer,
  action_taken text -- 'throttle_down', 'ramp_up', 'stable', 'emergency_pause'
);

CREATE INDEX idx_concurrency_snapshots_at ON public.concurrency_snapshots (snapshot_at DESC);

ALTER TABLE public.concurrency_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read concurrency" ON public.concurrency_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service insert concurrency" ON public.concurrency_snapshots FOR INSERT
  WITH CHECK (true);
