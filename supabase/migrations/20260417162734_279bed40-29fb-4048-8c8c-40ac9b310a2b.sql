SET session_replication_role = replica;

-- 1) Audit BEFORE
INSERT INTO admin_actions (action, scope, payload, affected_ids, before_state)
SELECT
  'phase_1b_meta_reset_validate_exam_pool',
  'pipeline_governance',
  jsonb_build_object(
    'reason', 'D+ validator fix deployed; reclassify legacy guard_state without state-rewind',
    'rule', 'meta-only reset + package unblock; no status flip on validate_exam_pool step',
    'timestamp', now()
  ),
  ARRAY(
    SELECT DISTINCT cp.id::text
    FROM course_packages cp
    LEFT JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key='validate_exam_pool'
    WHERE ps.meta ? 'guard_state'
       OR ps.meta ? 'stall_reason_code'
       OR cp.blocked_reason = 'pipeline_repair_required'
       OR cp.last_error ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
  ),
  (SELECT jsonb_agg(jsonb_build_object(
      'package_id', cp.id, 'title', cp.title,
      'cp_status', cp.status, 'cp_blocked_reason', cp.blocked_reason,
      'step_status', ps.status,
      'guard_state', ps.meta->>'guard_state',
      'stall_reason_code', ps.meta->>'stall_reason_code'))
    FROM course_packages cp
    LEFT JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key='validate_exam_pool'
    WHERE ps.meta ? 'guard_state' OR ps.meta ? 'stall_reason_code' OR cp.blocked_reason='pipeline_repair_required');

-- 2) Meta-only reset (KEIN status update)
UPDATE package_steps ps
SET attempts = 0, last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb)
           - 'guard_state' - 'stall_reason_code' - 'consecutive_no_progress'
           - 'last_error_at' - 'breaker_until' - 'breaker_reason'
         || jsonb_build_object(
              'reset_reason', 'dplus_validator_fix_reclassify_v1',
              'reset_at', now()::text,
              'reclassified_by', 'phase_1b_meta_only',
              'consecutive_no_progress', 0)
WHERE ps.step_key = 'validate_exam_pool'
  AND (ps.meta ? 'guard_state' OR ps.meta ? 'stall_reason_code'
       OR ps.meta ? 'consecutive_no_progress' OR ps.meta ? 'breaker_until'
       OR ps.last_error IS NOT NULL);

-- 3) Package unblock
UPDATE course_packages cp
SET status = CASE WHEN cp.status IN ('blocked','failed') THEN 'building' ELSE cp.status END,
    blocked_reason = NULL, stuck_reason = NULL, last_error = NULL,
    updated_at = now()
WHERE cp.blocked_reason = 'pipeline_repair_required'
   OR cp.stuck_reason ILIKE '%REPAIR_NO_EFFECT%'
   OR cp.last_error ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
   OR cp.status = 'blocked';

-- 4) Job-Registry: korrektes Schema (job_type, pool, description)
INSERT INTO ops_job_type_registry (job_type, pool, description)
VALUES (
  'package_repair_exam_pool_lf_coverage',
  'pipeline',
  'Targeted LF deficit repair: generates questions only for under-covered learning fields. Replaces full regen for REPAIR_LF_COVERAGE_SKEWED/MISSING gate states.'
)
ON CONFLICT (job_type) DO UPDATE
SET description = EXCLUDED.description, pool = EXCLUDED.pool;

-- 5) Audit AFTER
INSERT INTO admin_actions (action, scope, payload, after_state)
VALUES (
  'phase_1b_meta_reset_validate_exam_pool_completed',
  'pipeline_governance',
  jsonb_build_object('completed_at', now(),
    'next_step', 'Phase 2: build package-repair-exam-pool-lf-coverage edge function',
    'guardrails', jsonb_build_array(
      'no enqueue if active LF-repair job exists',
      'no enqueue if gate_status=PASS',
      'no enqueue if HARD_FAIL_NO_CURRICULUM',
      'no enqueue if same repair within 30min without delta')),
  (SELECT jsonb_build_object(
     'remaining_with_guard_state', COUNT(*) FILTER (WHERE ps.meta ? 'guard_state'),
     'remaining_blocked', (SELECT COUNT(*) FROM course_packages WHERE blocked_reason='pipeline_repair_required'))
   FROM package_steps ps WHERE ps.step_key='validate_exam_pool'));

SET session_replication_role = DEFAULT;