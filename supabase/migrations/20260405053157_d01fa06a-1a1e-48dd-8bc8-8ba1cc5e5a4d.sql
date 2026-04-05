
-- 1. BWL Bachelor: Fix STUDIUM feature flags
UPDATE course_packages
SET feature_flags = feature_flags 
  || '{"has_learning_course":true,"has_handbook":true,"has_minichecks":true,"has_practice_course_h5p":true}'::jsonb
WHERE id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND (feature_flags->>'has_learning_course')::text = 'false';

-- BWL Bachelor: Reset failed minichecks step
UPDATE package_steps
SET status = 'queued',
    last_error = 'HEAL: reset from failed for retry after flag fix',
    meta = COALESCE(meta, '{}'::jsonb) || '{"healed_at":"2026-04-05T05:35:00Z","heal_reason":"threshold_guard_after_flag_fix"}'::jsonb
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND step_key = 'generate_lesson_minichecks'
  AND status = 'failed';

-- 2. Industriekaufmann: Fix enqueued → queued
UPDATE package_steps
SET status = 'queued',
    meta = COALESCE(meta, '{}'::jsonb) || '{"healed_at":"2026-04-05T05:35:00Z","heal_reason":"enqueued_to_queued"}'::jsonb
WHERE package_id = 'f5e3403b-1fc6-46b3-a275-8420287f351e'
  AND step_key = 'generate_handbook'
  AND status = 'enqueued';

-- Industriekaufmann: ensure handbook job exists
INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT 'f5e3403b-1fc6-46b3-a275-8420287f351e',
       'package_generate_handbook', 'pending',
       jsonb_build_object('package_id','f5e3403b-1fc6-46b3-a275-8420287f351e','curriculum_id','055098ff-7cb0-4373-bd87-ff1979afc646'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='f5e3403b-1fc6-46b3-a275-8420287f351e' AND job_type='package_generate_handbook' AND status IN ('pending','queued','processing')
);

-- 3. Wirtschaftsinformatik: Add promote_blueprint_variants job
INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT 'c5000000-0004-4000-8000-000000000001',
       'package_promote_blueprint_variants', 'pending',
       jsonb_build_object('package_id','c5000000-0004-4000-8000-000000000001','curriculum_id','c2000000-0004-4000-8000-000000000001'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='c5000000-0004-4000-8000-000000000001' AND job_type='package_promote_blueprint_variants' AND status IN ('pending','queued','processing')
);

-- Wirtschaftsinformatik: Add validate_blueprint_variants job
INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT 'c5000000-0004-4000-8000-000000000001',
       'package_validate_blueprint_variants', 'pending',
       jsonb_build_object('package_id','c5000000-0004-4000-8000-000000000001','curriculum_id','c2000000-0004-4000-8000-000000000001'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='c5000000-0004-4000-8000-000000000001' AND job_type='package_validate_blueprint_variants' AND status IN ('pending','queued','processing')
);

-- 4. Verkäufer: Promote queued → building
UPDATE course_packages SET status = 'building'
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04' AND status = 'queued';

-- Verkäufer: Add integrity check job
INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT '59b6e214-e181-4c2b-986e-1ce544984d04',
       'package_run_integrity_check', 'pending',
       jsonb_build_object('package_id','59b6e214-e181-4c2b-986e-1ce544984d04','curriculum_id','63635f46-0186-49e7-80c1-67925dbdf638'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='59b6e214-e181-4c2b-986e-1ce544984d04' AND job_type='package_run_integrity_check' AND status IN ('pending','queued','processing')
);

-- 5. Wirtschaftsfachwirt: Add generate_learning_content job
INSERT INTO job_queue (package_id, job_type, status, payload, meta)
SELECT '03462382-f62e-4be9-9940-013d42a4435b',
       'package_generate_learning_content', 'pending',
       jsonb_build_object('package_id','03462382-f62e-4be9-9940-013d42a4435b','curriculum_id','1962472c-e2cc-4e38-974e-64036e6c9f4e'),
       '{"triggered_by":"admin_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id='03462382-f62e-4be9-9940-013d42a4435b' AND job_type='package_generate_learning_content' AND status IN ('pending','queued','processing')
);

-- Audit log
INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail) VALUES
  ('admin_ops', 'batch_heal', 'a0b0c0d0-0010-4000-8000-000000000001', 'package', 'success', '{"package":"BWL Bachelor","fix":"flags+minichecks"}'),
  ('admin_ops', 'batch_heal', 'f5e3403b-1fc6-46b3-a275-8420287f351e', 'package', 'success', '{"package":"Industriekaufmann","fix":"handbook enqueued→queued"}'),
  ('admin_ops', 'batch_heal', 'c5000000-0004-4000-8000-000000000001', 'package', 'success', '{"package":"Wirtschaftsinformatik","fix":"blueprint_variants jobs"}'),
  ('admin_ops', 'batch_heal', '59b6e214-e181-4c2b-986e-1ce544984d04', 'package', 'success', '{"package":"Verkäufer","fix":"queued→building+integrity"}'),
  ('admin_ops', 'batch_heal', '03462382-f62e-4be9-9940-013d42a4435b', 'package', 'success', '{"package":"Wirtschaftsfachwirt","fix":"generate_learning_content job"}');
