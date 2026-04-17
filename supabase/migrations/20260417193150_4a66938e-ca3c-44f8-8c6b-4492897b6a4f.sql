-- D+ Manual Heal Sweep: Direct unblock + meta-only step reset
WITH targets AS (
  SELECT unnest(ARRAY[
    '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid,
    '015e3cc4-b9c4-42f1-926d-346f3844030a'::uuid,
    '03287d1e-a4eb-4188-b65f-82eebf66dc82'::uuid
  ]) AS package_id
)
UPDATE course_packages cp
SET 
  status = 'queued',
  blocked_reason = NULL,
  blocked_at = NULL,
  blocked_by = NULL,
  stuck_reason = NULL,
  last_error = NULL,
  unblock_hint = 'D+ manual heal sweep — REPAIRABLE per gate classification',
  updated_at = now()
FROM targets t
WHERE cp.id = t.package_id;

-- validate_exam_pool steps: meta-only reset auf queued (Phase 1b Pattern)
UPDATE package_steps ps
SET 
  status = 'queued',
  attempts = 0,
  started_at = NULL,
  finished_at = NULL,
  last_error = NULL,
  meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
    'reset_at', now(),
    'reset_reason', 'dplus_manual_heal_sweep_v1',
    'unblocked_at', now(),
    'unblock_reason', 'manual_heal_sweep_to_repair_lf_coverage',
    'reclassified_by', 'admin_manual_heal_sweep'
  ),
  updated_at = now()
WHERE ps.package_id IN (
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  '015e3cc4-b9c4-42f1-926d-346f3844030a',
  '03287d1e-a4eb-4188-b65f-82eebf66dc82'
)
AND ps.step_key = 'validate_exam_pool'
AND ps.status IN ('failed','queued','blocked');

-- Audit-Log
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'manual_heal_sweep_dplus',
  'multi_package',
  ARRAY['5377ab93-fe17-488c-a266-bdb26b672da7','015e3cc4-b9c4-42f1-926d-346f3844030a','03287d1e-a4eb-4188-b65f-82eebf66dc82'],
  jsonb_build_object(
    'reason', 'D+ manual heal sweep — all 3 packages REPAIRABLE per gate',
    'next_step', 'enqueue_lf_coverage_repair / enqueue_quality_repair',
    'triggered_at', now()
  )
);