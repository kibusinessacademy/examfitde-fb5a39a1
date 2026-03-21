-- Add heartbeat/attempt tracking columns to llm_batches
-- Enables distinguishing: never started vs started-and-hung vs repeatedly-failed

ALTER TABLE llm_batches
  ADD COLUMN IF NOT EXISTS submit_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS submit_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

COMMENT ON COLUMN llm_batches.submit_started_at IS 'Timestamp when the actual provider upload/submit began (after DB insert)';
COMMENT ON COLUMN llm_batches.submit_attempts IS 'Number of times batch-submit attempted to upload to provider';
COMMENT ON COLUMN llm_batches.last_heartbeat_at IS 'Last activity timestamp, used by stale reaper for precise timeout detection';