
-- Cancel prematurely enqueued integrity check jobs (validate_exam_pool not done)
UPDATE job_queue jq
SET status = 'cancelled',
    locked_at = NULL,
    locked_by = NULL,
    meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'SSOT_DAG_UPSTREAM_NOT_READY',
      'cancelled_at', now()::text,
      'detail', 'validate_exam_pool not done — integrity check enqueued prematurely'
    )
FROM package_steps ps
WHERE jq.job_type = 'package_run_integrity_check'
  AND jq.status IN ('pending', 'processing')
  AND ps.package_id = jq.package_id
  AND ps.step_key = 'validate_exam_pool'
  AND ps.status != 'done';

-- Cancel prematurely enqueued quality_council jobs (integrity not done)
UPDATE job_queue jq
SET status = 'cancelled',
    locked_at = NULL,
    locked_by = NULL,
    meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'SSOT_DAG_UPSTREAM_NOT_READY',
      'cancelled_at', now()::text
    )
FROM package_steps ps
WHERE jq.job_type = 'package_quality_council'
  AND jq.status IN ('pending', 'processing')
  AND ps.package_id = jq.package_id
  AND ps.step_key = 'run_integrity_check'
  AND ps.status != 'done';

-- Cancel prematurely enqueued auto_publish jobs (quality_council not done)
UPDATE job_queue jq
SET status = 'cancelled',
    locked_at = NULL,
    locked_by = NULL,
    meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'SSOT_DAG_UPSTREAM_NOT_READY',
      'cancelled_at', now()::text
    )
FROM package_steps ps
WHERE jq.job_type = 'package_auto_publish'
  AND jq.status IN ('pending', 'processing')
  AND ps.package_id = jq.package_id
  AND ps.step_key = 'quality_council'
  AND ps.status != 'done';
