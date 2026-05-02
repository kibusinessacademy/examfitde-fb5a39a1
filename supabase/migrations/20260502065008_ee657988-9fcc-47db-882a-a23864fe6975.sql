-- ════════════════════════════════════════════════════════════════════
-- PATTERN X8: Auto-Publish Terminal-Loop Heal (manual bypass)
-- ════════════════════════════════════════════════════════════════════

-- 1) Cancel pending+failed auto_publish jobs that hit terminal guards.
--    These will never succeed in current package state — re-enqueue is futile.
WITH terminal_jobs AS (
  SELECT id, payload->>'package_id' AS pkg_id,
    CASE
      WHEN last_error LIKE '%COUNCIL_CONSISTENCY%' THEN 'COUNCIL_NOT_DONE'
      WHEN last_error LIKE '%DIDAKTIK_STEPS_INCOMPLETE%' THEN 'DIDAKTIK_INCOMPLETE'
      WHEN last_error LIKE '%PRICING_HARD_GATE%' THEN 'PRICING_GATE'
      WHEN last_error LIKE '%PARKED_PREREQ_NO_OUTPUT%' OR last_error_code='PARKED_PREREQ_NO_OUTPUT' THEN 'PARKED_PREREQ'
      WHEN last_error LIKE '%PARKED_AWAITING_PRECONDITION%' THEN 'PARKED_PREREQ'
      ELSE NULL
    END AS x8_reason
  FROM job_queue
  WHERE job_type='package_auto_publish'
    AND status IN ('pending','failed')
    AND last_error IS NOT NULL
)
UPDATE job_queue jq
SET status='cancelled',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = 'PATTERN_X8_TERMINAL_HEAL',
    last_error = COALESCE(jq.last_error,'') || ' | X8_HEAL: ' || tj.x8_reason,
    meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
      'pattern_x8_heal', true,
      'x8_reason', tj.x8_reason,
      'x8_healed_at', now()
    ),
    updated_at = now()
FROM terminal_jobs tj
WHERE jq.id = tj.id AND tj.x8_reason IS NOT NULL;

-- 2) For packages with COUNCIL_CONSISTENCY: council was skipped (defer-bridge missing).
--    Defer auto_publish step too → marks the publish chain as parked.
WITH affected AS (
  SELECT DISTINCT (jq.payload->>'package_id')::uuid AS pkg
  FROM job_queue jq
  WHERE jq.job_type='package_auto_publish'
    AND jq.last_error LIKE '%COUNCIL_CONSISTENCY%'
)
UPDATE package_steps ps
SET status='skipped',
    last_error = 'PATTERN_X8: parked — quality_council deferred without council_approved bridge',
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'skipped_reason', 'PATTERN_X8_COUNCIL_NOT_BRIDGED',
      'pattern_x8_at', now()
    ),
    updated_at = now()
FROM affected
WHERE ps.package_id = affected.pkg
  AND ps.step_key = 'auto_publish'
  AND ps.status NOT IN ('done','skipped');

-- 3) PRICING_HARD_GATE: defer auto_publish (pkg needs Stripe price first).
WITH pricing_pkgs AS (
  SELECT DISTINCT (jq.payload->>'package_id')::uuid AS pkg
  FROM job_queue jq
  WHERE jq.job_type='package_auto_publish' AND jq.last_error LIKE '%PRICING_HARD_GATE%'
)
UPDATE package_steps ps
SET status='skipped',
    last_error='PATTERN_X8: parked — pricing missing (Stripe price + product_id required)',
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'skipped_reason','PATTERN_X8_PRICING_GATE',
      'pattern_x8_at', now()
    ),
    updated_at=now()
FROM pricing_pkgs
WHERE ps.package_id = pricing_pkgs.pkg
  AND ps.step_key='auto_publish'
  AND ps.status NOT IN ('done','skipped');

-- 4) DIDAKTIK_INCOMPLETE: park auto_publish until didaktik tail completes (atomic-trigger will re-enqueue when didaktik done).
WITH didaktik_pkgs AS (
  SELECT DISTINCT (jq.payload->>'package_id')::uuid AS pkg
  FROM job_queue jq
  WHERE jq.job_type='package_auto_publish' AND jq.last_error LIKE '%DIDAKTIK_STEPS_INCOMPLETE%'
)
UPDATE package_steps ps
SET status='skipped',
    last_error='PATTERN_X8: parked — didaktik tail incomplete (will be revived when tail done)',
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'skipped_reason','PATTERN_X8_DIDAKTIK_INCOMPLETE',
      'pattern_x8_at', now()
    ),
    updated_at=now()
FROM didaktik_pkgs
WHERE ps.package_id = didaktik_pkgs.pkg
  AND ps.step_key='auto_publish'
  AND ps.status NOT IN ('done','skipped');

-- 5) Reset clean PARKED_PREREQ pendings to fresh attempt-state IF the prereq (council) is now done.
--    These were parked when council was queued; council is done now → safe re-attempt.
WITH parked_recovered AS (
  SELECT jq.id
  FROM job_queue jq
  JOIN package_steps ps ON ps.package_id = (jq.payload->>'package_id')::uuid AND ps.step_key='quality_council'
  WHERE jq.job_type='package_auto_publish'
    AND jq.status='pending'
    AND (jq.last_error_code='PATTERN_X8_TERMINAL_HEAL' OR jq.last_error LIKE '%PARKED_PREREQ%')
    AND ps.status='done'
)
UPDATE job_queue jq
SET attempts = 0,
    last_error = NULL,
    last_error_code = NULL,
    locked_at = NULL,
    locked_by = NULL,
    priority = 5,
    updated_at = now()
FROM parked_recovered
WHERE jq.id = parked_recovered.id;

-- 6) Audit log
INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
SELECT 
  'pattern_x8_auto_publish_terminal_heal',
  'system',
  NULL,
  'success',
  'Healed auto_publish terminal-loop: cancelled non-recoverable + deferred unsatisfiable steps + reset parked-prereq with council=done',
  jsonb_build_object(
    'cancelled_jobs', (SELECT COUNT(*) FROM job_queue WHERE last_error_code='PATTERN_X8_TERMINAL_HEAL' AND updated_at > now() - interval '1 minute'),
    'deferred_steps', (SELECT COUNT(*) FROM package_steps WHERE step_key='auto_publish' AND meta->>'pattern_x8_at' IS NOT NULL AND (meta->>'pattern_x8_at')::timestamptz > now() - interval '1 minute'),
    'runner_fix_deployed', 'job-runner now honors {terminal:true} in 422 responses',
    'healed_at', now()
  );
