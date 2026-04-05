
-- 1. AEVO: Reset stuck 'running' step
UPDATE package_steps
SET status = 'queued',
    last_error = 'HEAL: reset from running after WIP demotion cancelled job',
    meta = COALESCE(meta, '{}'::jsonb) || '{"healed_at":"2026-04-05T05:30:00Z","heal_reason":"running_zombie"}'::jsonb
WHERE package_id = 'b960658d-95e9-4824-a404-821d5e9b5142'
  AND step_key = 'fanout_learning_content'
  AND status = 'running';

-- 2. PRINCE2: Insert missing jobs
INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
       'package_generate_learning_content', 'pending',
       jsonb_build_object('package_id','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','curriculum_id','192af095-c7b8-4556-b0a7-246ef54749e1'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='bae6fc7b-6c03-4716-aeb5-5a84d9bb83af' AND job_type='package_generate_learning_content' AND status IN ('pending','queued','processing')
);

INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
       'package_auto_seed_exam_blueprints', 'pending',
       jsonb_build_object('package_id','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','curriculum_id','192af095-c7b8-4556-b0a7-246ef54749e1'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='bae6fc7b-6c03-4716-aeb5-5a84d9bb83af' AND job_type='package_auto_seed_exam_blueprints' AND status IN ('pending','queued','processing')
);

-- 3. Scrum Master: Insert missing jobs
INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT '65430b12-b481-46e0-88f4-c88606857da7',
       'package_generate_learning_content', 'pending',
       jsonb_build_object('package_id','65430b12-b481-46e0-88f4-c88606857da7','curriculum_id','225a26f3-cb03-4d0a-aac1-ba8fd1442272'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='65430b12-b481-46e0-88f4-c88606857da7' AND job_type='package_generate_learning_content' AND status IN ('pending','queued','processing')
);

INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT '65430b12-b481-46e0-88f4-c88606857da7',
       'package_finalize_learning_content', 'pending',
       jsonb_build_object('package_id','65430b12-b481-46e0-88f4-c88606857da7','curriculum_id','225a26f3-cb03-4d0a-aac1-ba8fd1442272'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='65430b12-b481-46e0-88f4-c88606857da7' AND job_type='package_finalize_learning_content' AND status IN ('pending','queued','processing')
);

-- 4. Lagerlogistik: Recover from blocked
UPDATE course_packages SET status = 'building'
WHERE id = 'f2039067-e58a-4e94-9573-b5953d435873' AND status = 'blocked';

INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT 'f2039067-e58a-4e94-9573-b5953d435873',
       'package_generate_exam_pool', 'pending',
       jsonb_build_object('package_id','f2039067-e58a-4e94-9573-b5953d435873','curriculum_id','516618c7-ba4d-4e1a-bee6-b609b513ebd3'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='f2039067-e58a-4e94-9573-b5953d435873' AND job_type='package_generate_exam_pool' AND status IN ('pending','queued','processing')
);

-- 5. Büromanagement: Backfill missing steps
INSERT INTO package_steps (package_id, step_key, status, meta)
SELECT '5377ab93-fe17-488c-a266-bdb26b672da7', 'validate_blueprints', 'done',
       '{"healed_at":"2026-04-05T05:30:00Z","heal_reason":"step_missing_from_old_scaffold","auto_promoted":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM package_steps WHERE package_id='5377ab93-fe17-488c-a266-bdb26b672da7' AND step_key='validate_blueprints');

INSERT INTO package_steps (package_id, step_key, status, meta)
SELECT '5377ab93-fe17-488c-a266-bdb26b672da7', 'build_ai_tutor_index', 'queued',
       '{"healed_at":"2026-04-05T05:30:00Z","heal_reason":"step_missing_from_old_scaffold"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM package_steps WHERE package_id='5377ab93-fe17-488c-a266-bdb26b672da7' AND step_key='build_ai_tutor_index');

INSERT INTO package_steps (package_id, step_key, status, meta)
SELECT '5377ab93-fe17-488c-a266-bdb26b672da7', 'quality_council', 'queued',
       '{"healed_at":"2026-04-05T05:30:00Z","heal_reason":"step_missing_from_old_scaffold"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM package_steps WHERE package_id='5377ab93-fe17-488c-a266-bdb26b672da7' AND step_key='quality_council');

-- Audit
INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail) VALUES
  ('admin_ops', 'reset_running_to_queued', 'b960658d-95e9-4824-a404-821d5e9b5142', 'package', 'success', '{"step":"fanout_learning_content","package":"AEVO"}'),
  ('admin_ops', 'materialize_missing_jobs', 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af', 'package', 'success', '{"package":"PRINCE2"}'),
  ('admin_ops', 'materialize_missing_jobs', '65430b12-b481-46e0-88f4-c88606857da7', 'package', 'success', '{"package":"Scrum Master"}'),
  ('admin_ops', 'unblock_and_reconcile', 'f2039067-e58a-4e94-9573-b5953d435873', 'package', 'success', '{"package":"Lagerlogistik"}'),
  ('admin_ops', 'backfill_missing_steps', '5377ab93-fe17-488c-a266-bdb26b672da7', 'package', 'success', '{"package":"Büromanagement"}');
