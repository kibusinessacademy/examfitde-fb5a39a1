
-- Fix the remaining CHECK constraint that blocks system jobs
ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS job_queue_payload_has_curriculum_id;

ALTER TABLE job_queue ADD CONSTRAINT job_queue_payload_has_curriculum_id
  CHECK (
    job_type IN ('pipeline_tick', 'stuck_scan')
    OR (payload ? 'curriculum_id')
  );
