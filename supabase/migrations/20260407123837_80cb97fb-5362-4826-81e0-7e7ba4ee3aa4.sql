
-- Drop the old CHECK constraint that doesn't exempt system jobs
ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS job_queue_payload_curriculum_id_uuid;

-- Re-create with system job exemption
ALTER TABLE job_queue ADD CONSTRAINT job_queue_payload_curriculum_id_uuid
  CHECK (
    job_type IN ('pipeline_tick', 'stuck_scan')
    OR ((payload ->> 'curriculum_id')::uuid IS NOT NULL)
  );
