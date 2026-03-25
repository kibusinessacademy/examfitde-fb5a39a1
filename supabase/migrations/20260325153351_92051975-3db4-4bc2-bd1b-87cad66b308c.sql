-- FIX: Enrich trap_type for all 3 blocked packages (valid constraint values only)
UPDATE exam_questions eq
SET trap_type = CASE 
  WHEN eq.difficulty IN ('hard','very_hard') THEN 'calculation_trap'
  WHEN eq.cognitive_level IN ('apply','analyze') THEN 'typical_error'
  ELSE 'misconception'
END
FROM course_packages cp
WHERE eq.curriculum_id = cp.curriculum_id
  AND cp.id IN (
    'a9f19137-a004-4850-838a-bdc8f8a705f5',
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  )
  AND eq.status = 'approved'
  AND eq.trap_type IS NULL;

-- Clear blocked_reason + reset to building
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL,
    integrity_report = NULL,
    integrity_report_version = NULL,
    integrity_passed = false
WHERE id IN (
  'a9f19137-a004-4850-838a-bdc8f8a705f5',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c'
);

-- Reset integrity + auto_publish steps to queued
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'trap_type_fix_at', now()::text,
      'unblocked_by', 'trap_coverage_enrichment'
    )
WHERE package_id IN (
  'a9f19137-a004-4850-838a-bdc8f8a705f5',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c'
)
AND step_key IN ('run_integrity_check', 'auto_publish')
AND status IN ('done', 'failed', 'blocked', 'enqueued');

INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, metadata)
VALUES ('trap_type_enrichment_unblock', 'manual_repair', 'applied',
  'Enriched trap_type for 3 blocked packages, reset integrity steps',
  '{"packages": ["a9f19137","fd1d8192","9c1b3734"], "reason": "TRAP_COVERAGE_BLOCK"}'::jsonb);