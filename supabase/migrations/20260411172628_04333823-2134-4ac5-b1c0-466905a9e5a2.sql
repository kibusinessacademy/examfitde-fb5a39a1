-- Cancel duplicate blueprint variant jobs for Pharmazeutisch-kaufmännischer Angestellter/-in
-- Keep only the oldest one, cancel the rest
WITH keep AS (
  SELECT id FROM job_queue
  WHERE job_type = 'package_generate_blueprint_variants'
    AND package_id = '62b52784-6d73-458a-9196-631091877c26'
    AND status IN ('pending','queued','processing')
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'HEAL: duplicate fan-out cancelled — dedup fix applied',
    updated_at = now()
WHERE job_type = 'package_generate_blueprint_variants'
  AND package_id = '62b52784-6d73-458a-9196-631091877c26'
  AND status IN ('pending','queued','processing')
  AND id NOT IN (SELECT id FROM keep);