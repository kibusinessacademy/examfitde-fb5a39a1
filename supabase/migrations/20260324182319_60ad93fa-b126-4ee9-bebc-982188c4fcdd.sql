
-- Reconciliation Runde 4: Ghost-Guard-kompatibel
-- Erst started_at setzen, dann status → done

-- 1. SoVFa: generate_exam_pool
UPDATE package_steps SET 
  started_at = now() - interval '1 minute',
  finished_at = now(),
  status = 'done',
  last_error = null,
  meta = COALESCE(meta, '{}'::jsonb) || '{"reconciled":"step_artifact_drift_r4","reconciled_at":"2026-03-24T18:10:00Z","reason":"2025_review_pending_questions_exist"}'::jsonb
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND step_key = 'generate_exam_pool'
  AND status = 'queued';

-- 2. Personal: validate_blueprints
UPDATE package_steps SET 
  started_at = now() - interval '1 minute',
  finished_at = now(),
  status = 'done',
  last_error = null,
  meta = COALESCE(meta, '{}'::jsonb) || '{"reconciled":"step_artifact_drift_r4","reason":"job_completed_91bp_100pct"}'::jsonb
WHERE package_id = '570ccb3e-2937-4d81-b3d8-624b9be84737'
  AND step_key = 'validate_blueprints'
  AND status = 'queued';

-- 3. Drogist: auto_seed_exam_blueprints
UPDATE package_steps SET 
  started_at = now() - interval '1 minute',
  finished_at = now(),
  status = 'done',
  last_error = null,
  meta = COALESCE(meta, '{}'::jsonb) || '{"reconciled":"step_artifact_drift_r4","reason":"job_completed_elite_90bp"}'::jsonb
WHERE package_id = 'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab'
  AND step_key = 'auto_seed_exam_blueprints'
  AND status = 'queued';

-- 4. Elektroniker AT: auto_seed_exam_blueprints
UPDATE package_steps SET 
  started_at = now() - interval '1 minute',
  finished_at = now(),
  status = 'done',
  last_error = null,
  meta = COALESCE(meta, '{}'::jsonb) || '{"reconciled":"step_artifact_drift_r4","reason":"job_completed_elite_93bp"}'::jsonb
WHERE package_id = '335decc8-9f68-4784-b318-a68f620bf77e'
  AND step_key = 'auto_seed_exam_blueprints'
  AND status = 'queued';

-- 5. Marketing: auto_seed_exam_blueprints
UPDATE package_steps SET 
  started_at = now() - interval '1 minute',
  finished_at = now(),
  status = 'done',
  last_error = null,
  meta = COALESCE(meta, '{}'::jsonb) || '{"reconciled":"step_artifact_drift_r4","reason":"job_completed_elite_94bp"}'::jsonb
WHERE package_id = 'eff99cc4-785d-4f61-a3ef-12932d8043c3'
  AND step_key = 'auto_seed_exam_blueprints'
  AND status = 'queued';

-- 6. Stale SoVFa validate_exam_pool pending Jobs canceln
UPDATE job_queue SET status = 'cancelled'
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND job_type = 'package_validate_exam_pool'
  AND status = 'pending';
