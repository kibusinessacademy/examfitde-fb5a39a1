
-- 1) Add trust_score to question_attempts
ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS trust_score numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS time_spent_ms integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attempt_number integer DEFAULT 1;

-- 2) Extend competency_performance_stats with robust aggregation columns
ALTER TABLE public.competency_performance_stats
  ADD COLUMN IF NOT EXISTS unique_learners integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trusted_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_pass_fail_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repeat_fail_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frozen boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS frozen_by text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS consecutive_critical_runs integer DEFAULT 0;

-- 3) Index for efficient trust-filtered aggregation
CREATE INDEX IF NOT EXISTS idx_question_attempts_trust
  ON public.question_attempts (question_id, trust_score)
  WHERE trust_score >= 0.6;
