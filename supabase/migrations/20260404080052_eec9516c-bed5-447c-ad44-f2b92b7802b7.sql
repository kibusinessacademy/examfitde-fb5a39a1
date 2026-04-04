
-- Direct insert for missing steps (ON CONFLICT DO NOTHING for safety)
INSERT INTO package_steps (package_id, step_key, status)
VALUES
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'auto_seed_exam_blueprints', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'generate_exam_pool', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'validate_exam_pool', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'elite_harden', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'generate_glossary', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'generate_handbook', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'validate_handbook', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'validate_handbook_depth', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'generate_oral_exam', 'queued'),
  ('5377ab93-fe17-488c-a266-bdb26b672da7', 'validate_oral_exam', 'queued')
ON CONFLICT (package_id, step_key) DO NOTHING;

-- Cancel orphaned jobs
UPDATE job_queue 
SET status = 'cancelled', updated_at = now(), last_error = 'ORPHAN_CLEANUP: steps not seeded at time of enqueue'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
AND job_type IN ('package_generate_exam_pool', 'package_validate_exam_pool', 'package_elite_harden', 'package_run_integrity_check')
AND status IN ('pending', 'processing');
