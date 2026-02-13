
-- =====================================================
-- TRIAGE POLICY TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.triage_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  mode text NOT NULL DEFAULT 'NO_BREAK_PRODUCTION',
  policy_json jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

ALTER TABLE public.triage_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read triage_policy" ON public.triage_policy
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_triage_policy_active
  ON public.triage_policy (is_active) WHERE is_active = true;

-- =====================================================
-- DEAD LETTER TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.dead_letter_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  package_id uuid,
  job_type text NOT NULL,
  error_category text NOT NULL,
  error_code text,
  error_message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text
);

ALTER TABLE public.dead_letter_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read dead_letter_jobs" ON public.dead_letter_jobs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_dead_letter_unresolved
  ON public.dead_letter_jobs (created_at DESC) WHERE resolved_at IS NULL;

-- =====================================================
-- ADD columns to job_queue
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='job_queue' AND column_name='last_error_severity') THEN
    ALTER TABLE public.job_queue ADD COLUMN last_error_severity text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='job_queue' AND column_name='fallback_count') THEN
    ALTER TABLE public.job_queue ADD COLUMN fallback_count int DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='job_queue' AND column_name='original_provider') THEN
    ALTER TABLE public.job_queue ADD COLUMN original_provider text;
  END IF;
END$$;

-- =====================================================
-- SEED ACTIVE TRIAGE POLICY
-- =====================================================
INSERT INTO public.triage_policy (version, mode, is_active, policy_json, notes)
VALUES (
  '1.0',
  'NO_BREAK_PRODUCTION',
  true,
  '{"goals":{"completion_first":true,"never_fail_on_rate_limit":true,"maximize_throughput_without_cascade_failures":true,"keep_queue_moving":true},"controls":{"max_active_packages":4,"max_parallel_jobs_per_package":2,"max_global_processing_jobs":40,"provider_concurrency_limits":{"openai":{"max_running":6,"cooldown_seconds":75},"anthropic":{"max_running":4,"cooldown_seconds":75},"google":{"max_running":4,"cooldown_seconds":75}},"budget":{"hard_stop":false,"monthly_budget_eur":2000,"soft_alerts":[{"threshold_eur":1500,"action":"warn_admin"},{"threshold_eur":1800,"action":"warn_admin_strong"}]}},"routing":{"default_provider_order":["openai","anthropic","google"],"provider_fallback_on":["429","TIMEOUT","TRANSIENT_NETWORK"],"fallback_strategy":{"max_fallbacks_per_job":2,"cooldown_on_fallback_seconds":20,"switch_provider_if_rate_limited_until_gt_seconds":30}},"retry":{"max_attempts_default":12,"max_attempts_rate_limit":20,"max_attempts_timeout":15,"max_attempts_transient":12,"backoff":{"type":"exponential_with_jitter","base_seconds":10,"max_seconds":600,"jitter_seconds_range":[0,30]},"scheduled_at":{"respect_delays":true,"rate_limit_delay_seconds_default":60,"timeout_delay_seconds_default":45,"transient_delay_seconds_default":30}},"classification":{"error_code_map":{"429":"RATE_LIMIT","RATE_LIMIT":"RATE_LIMIT","TOO_MANY_REQUESTS":"RATE_LIMIT","ETIMEDOUT":"TIMEOUT","TIMEOUT":"TIMEOUT","GATEWAY_TIMEOUT":"TIMEOUT","ECONNRESET":"TRANSIENT_NETWORK","ENOTFOUND":"TRANSIENT_NETWORK","EAI_AGAIN":"TRANSIENT_NETWORK","VALIDATION_ERROR":"PERMANENT_DATA","SCHEMA_MISMATCH":"PERMANENT_CODE","SSOT_VIOLATION":"PERMANENT_CODE","FOREIGN_KEY_VIOLATION":"PERMANENT_DATA","RLS_DENIED":"PERMANENT_SECURITY","UNAUTHORIZED":"PERMANENT_SECURITY"}},"actions":{"RATE_LIMIT":{"set_status":"pending","delay_seconds":60,"ensure_not_failed":true,"maybe_switch_provider":true,"decrement_concurrency":true},"TIMEOUT":{"set_status":"pending","delay_seconds":45,"maybe_switch_provider":true},"TRANSIENT_NETWORK":{"set_status":"pending","delay_seconds":30,"maybe_switch_provider":true},"PERMANENT_CODE":{"set_status":"failed","severity":"critical","block_package":true,"dead_letter":true},"PERMANENT_DATA":{"set_status":"failed","severity":"high","block_package":true,"dead_letter":true},"PERMANENT_SECURITY":{"set_status":"failed","severity":"critical","block_package":true,"dead_letter":true}},"production_specific":{"exam_generation":{"chunk_size":75,"target_questions_ship":800,"target_questions_ideal":1000,"requeue_until_target":true,"min_delay_between_chunks_seconds":15},"stuck_detection":{"job_processing_heartbeat_timeout_seconds":600,"package_no_progress_timeout_minutes":90}}}'::jsonb,
  'Initial No-Break Production policy v1.0'
);
