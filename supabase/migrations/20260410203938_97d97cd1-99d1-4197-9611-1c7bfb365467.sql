
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'cancelled: package not building (intentional_pause cleanup)',
    updated_at = now()
WHERE status IN ('queued','pending','processing','running','batch_pending')
  AND package_id IN (
    SELECT id FROM course_packages WHERE status != 'building'
  );
