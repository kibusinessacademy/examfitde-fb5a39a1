
-- ============================================================
-- Remediation: Fix all 3 blocked/stalled packages
-- ============================================================

-- ── 1. Industriemechaniker: Prune 4 oldest easy questions to hit ≤15% ──
UPDATE exam_questions
SET status = 'rejected',
    qc_status = 'pruned_overflow'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'
    AND status = 'approved'
    AND difficulty = 'easy'
  ORDER BY created_at ASC
  LIMIT 4
);

-- ── 2. Industriemechaniker: Reset validate_exam_pool kill_switch ──
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = '{"remediation": "easy_too_high_pruned_4", "remediation_at": "2026-03-20T22:20:00Z"}'::jsonb
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'validate_exam_pool';

-- ── 3. Industriemechaniker: Reset downstream steps ──
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = meta || '{"remediation": "unblocked_after_easy_prune", "remediation_at": "2026-03-20T22:20:00Z"}'::jsonb
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key IN ('run_integrity_check', 'auto_publish', 'quality_council', 'council_review', 'elite_harden')
  AND status IN ('queued', 'blocked');

-- ── 4. Industriemechaniker: Unblock package ──
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'blocked';

-- ── 5. Mechatroniker & MFA: Confirm run_integrity_check is queued ──
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL
WHERE package_id IN ('2e8da39f-60f8-44d9-8b70-e1176222ca55', '11b697be-07a8-4164-ab1b-a8747ec49b03')
  AND step_key = 'run_integrity_check'
  AND status != 'done';

-- ── 6. Audit trail ──
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'remediation_all_blocked_packages',
  'package',
  ARRAY[
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',
    '11b697be-07a8-4164-ab1b-a8747ec49b03'
  ],
  '{"industriemechaniker": {"root_cause": "EASY_TOO_HIGH 15.8%", "fix": "pruned 4 easy, reset kill_switch"}, "mechatroniker": {"root_cause": "PERSISTENCE_DEFECT", "fix": "integrity step re-queued"}, "mfa": {"root_cause": "PERSISTENCE_DEFECT", "fix": "integrity step re-queued"}}'::jsonb
);
