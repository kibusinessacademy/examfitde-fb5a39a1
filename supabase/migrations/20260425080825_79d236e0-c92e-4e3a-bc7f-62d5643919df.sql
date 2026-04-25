-- Healing v3: corrected admin_notifications schema (category/metadata)

UPDATE job_queue
SET status='cancelled', last_error_code='PARKED_AWAITING_REPAIR',
    last_error=COALESCE(last_error,'')||' | auto-cancelled: exam-pool-quality repair enqueued',
    updated_at=now()
WHERE job_type='package_run_integrity_check' AND status='failed';

INSERT INTO job_queue (job_type, payload, lane, status, priority, created_at, updated_at)
SELECT 'package_repair_exam_pool_quality',
  jsonb_build_object('package_id',cp.id,'curriculum_id',cp.curriculum_id,
    'reason','integrity_score_below_92','enqueued_by','healing_migration_2026_04_25'),
  'recovery','pending',10,now(),now()
FROM course_packages cp
WHERE cp.id IN ('04634848-89a3-4726-af1f-2f04aa4eacf7','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
  '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','ba96f6d9-c638-4bf3-aaca-3465ac363e8b')
AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id=cp.id
  AND jq.job_type='package_repair_exam_pool_quality' AND jq.status IN ('pending','processing'));

-- 3a04033e
UPDATE job_queue SET status='cancelled', last_error_code='PARKED_AWAITING_REPAIR',
  last_error=COALESCE(last_error,'')||' | auto-cancelled: minicheck regen enqueued',
  updated_at=now() WHERE id='3a04033e-80b5-417b-9a9a-d760baeb722e';

INSERT INTO job_queue (job_type, payload, lane, status, priority, created_at, updated_at)
SELECT 'package_generate_lesson_minichecks',
  jsonb_build_object('package_id','96d0fb31-9951-408d-a83e-b2937f5a6af8',
    'curriculum_id','53d13046-88bf-42bf-9a2e-05d5e4a4f272',
    'reason','coverage_86pct_below_threshold','force_regenerate',true,
    'target_coverage',95,'enqueued_by','healing_migration_2026_04_25'),
  'recovery','pending',15,now(),now()
WHERE NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id='96d0fb31-9951-408d-a83e-b2937f5a6af8'
  AND jq.job_type='package_generate_lesson_minichecks' AND jq.status IN ('pending','processing'));

-- a1d91d66
UPDATE job_queue SET status='cancelled', last_error_code='PARKED_AWAITING_REPAIR',
  last_error=COALESCE(last_error,'')||' | auto-cancelled: generator re-enqueued',
  updated_at=now() WHERE id='a1d91d66-ca0f-400b-a9e5-ab0ba01b0aa8';

INSERT INTO job_queue (job_type, payload, lane, status, priority, created_at, updated_at)
SELECT 'package_generate_lesson_minichecks',
  jsonb_build_object('package_id','d2000001-0009-4000-8000-000000000001',
    'curriculum_id','c2000000-0014-4000-8000-000000000001',
    'reason','no_minichecks_artifacts','force_regenerate',true,
    'enqueued_by','healing_migration_2026_04_25'),
  'recovery','pending',15,now(),now()
WHERE NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id='d2000001-0009-4000-8000-000000000001'
  AND jq.job_type='package_generate_lesson_minichecks' AND jq.status IN ('pending','processing'));

-- 8d1ccdfa
UPDATE job_queue SET status='cancelled', last_error_code='PARKED_AWAITING_REPAIR',
  last_error=COALESCE(last_error,'')||' | auto-cancelled: validate_blueprints re-enqueued',
  updated_at=now() WHERE id='8d1ccdfa-0815-410c-81b0-7d4aab465512';

INSERT INTO job_queue (job_type, payload, lane, status, priority, created_at, updated_at)
SELECT 'package_validate_blueprints',
  jsonb_build_object('package_id','2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2',
    'curriculum_id','cdb12a5a-2c21-408a-8879-ef5afa52057d',
    'reason','downstream_variants_blocked_prereq_not_done',
    'enqueued_by','healing_migration_2026_04_25'),
  'recovery','pending',15,now(),now()
WHERE NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id='2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2'
  AND jq.job_type='package_validate_blueprints' AND jq.status IN ('pending','processing'));

-- Audit
INSERT INTO admin_notifications (category, severity, title, body, metadata, created_at)
VALUES ('healing_migration','info',
  'Healing 2026-04-25: 28 Integrity-Jobs + 3 Pending repariert',
  'Cancelled 28 failed package_run_integrity_check jobs (4 packages, score 89-91, gate 92) and enqueued package_repair_exam_pool_quality. Healed 3 specific stuck jobs: 3a04033e (FI-SI MiniCheck 86%→regen), a1d91d66 (BWL-Steuern NO_MINICHECKS→regen), 8d1ccdfa (FI-DV Blueprint PREREQ→re-validate).',
  jsonb_build_object(
    'integrity_packages',jsonb_build_array(
      '04634848-89a3-4726-af1f-2f04aa4eacf7','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
      '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','ba96f6d9-c638-4bf3-aaca-3465ac363e8b'),
    'specific_jobs',jsonb_build_array(
      '3a04033e-80b5-417b-9a9a-d760baeb722e','a1d91d66-ca0f-400b-a9e5-ab0ba01b0aa8',
      '8d1ccdfa-0815-410c-81b0-7d4aab465512')),
  now());