-- ============================================================
-- Remediation: Verkäufer/-in (59b6e214) – 2 Blocker beheben
-- ============================================================

-- ── 1. Reset validate_exam_pool (failed from stale constraint error) ──
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"remediation": "constraint_error_stale_reset", "remediation_at": "2026-03-20T22:30:00Z"}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'validate_exam_pool';

-- ── 2. Re-queue auto_seed_exam_blueprints (PERSISTENCE_DEFECT: 0 blueprints) ──
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"remediation": "persistence_defect_0_blueprints", "remediation_at": "2026-03-20T22:30:00Z"}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'auto_seed_exam_blueprints';

-- ── 3. Reset downstream steps that depend on these ──
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key IN ('validate_blueprints', 'run_integrity_check', 'auto_publish')
  AND status = 'done';

-- ── 4. Audit trail ──
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'remediation_verkaeufer_pipeline',
  'package',
  ARRAY['59b6e214-e181-4c2b-986e-1ce544984d04'],
  '{"root_causes": ["validate_exam_pool FAILED from stale constraint error (0 violations now)", "PERSISTENCE_DEFECT: auto_seed_exam_blueprints=done but 0 blueprints exist"], "fixes": ["reset validate_exam_pool to queued", "reset auto_seed_exam_blueprints to queued", "reset validate_blueprints + integrity + publish"]}'::jsonb
);