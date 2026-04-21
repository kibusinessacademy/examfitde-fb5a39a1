
-- A) Industriemeister
UPDATE package_steps
SET status='queued', last_error=NULL, attempts=0,
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by','admin_manual',
      'manual_review_required', false,
      'auto_requeue_blocked', false,
      'reopened_by','p0_evidence_publish_industriemeister',
      'reopened_at', now(),
      'evidence','effective_state=passed; coverage=100%; q_approved=1030'
    )
WHERE package_id='961103c5-74be-4357-8573-c73862cb09b2'
  AND step_key='auto_publish';

INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, scheduled_at)
SELECT 'package_auto_publish',
       cp.id,
       'pending', 100,
       jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id),
       jsonb_build_object('source','p0_evidence_publish','evidence','effective_state=passed'),
       now()
FROM course_packages cp
WHERE cp.id='961103c5-74be-4357-8573-c73862cb09b2'
  AND NOT EXISTS (
    SELECT 1 FROM job_queue
    WHERE job_type='package_auto_publish'
      AND package_id=cp.id
      AND status IN ('pending','queued','processing','running')
  );

-- B) FI Systemintegration — Repair
UPDATE course_packages SET status='building', updated_at=now()
WHERE id='96d0fb31-9951-408d-a83e-b2937f5a6af8' AND status<>'building';

UPDATE package_steps
SET status='queued', last_error=NULL, attempts=0,
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by','admin_manual',
      'manual_review_required', false,
      'auto_requeue_blocked', false,
      'reopened_by','p0_evidence_repair_fi',
      'reopened_at', now(),
      'evidence','blueprints_approved=0/334, comp_coverage=50%, LF10-13 underfilled'
    )
WHERE package_id='96d0fb31-9951-408d-a83e-b2937f5a6af8'
  AND step_key IN (
    'validate_blueprints','generate_exam_pool','repair_exam_pool_quality',
    'validate_exam_pool','run_integrity_check','quality_council','auto_publish'
  );

UPDATE job_queue
SET status='cancelled', completed_at=now(),
    last_error='superseded by p0_evidence_repair_fi',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancelled_by','p0_evidence_repair_fi')
WHERE package_id='96d0fb31-9951-408d-a83e-b2937f5a6af8'
  AND status IN ('pending','queued','processing','running','batch_pending','failed');

INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, scheduled_at)
SELECT 'package_validate_blueprints',
       cp.id,
       'pending', 90,
       jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id),
       jsonb_build_object('source','p0_evidence_repair_fi','reason','0/334 blueprints approved','allow_regression',true,'allow_regression_by','admin_manual'),
       now()
FROM course_packages cp
WHERE cp.id='96d0fb31-9951-408d-a83e-b2937f5a6af8';

INSERT INTO admin_actions(scope, action, payload, affected_ids)
VALUES (
  'package',
  'p0_evidence_based_publish_and_repair',
  jsonb_build_object(
    'industriemeister', jsonb_build_object('decision','PUBLISH','evidence_passed',true,'q_approved',1030,'coverage_pct',100),
    'fi_systemintegration', jsonb_build_object('decision','REPAIR_BUILD','blueprints_approved','0/334','coverage_pct',50,'underfilled_lf','LF10:9, LF11:19, LF12:33, LF13:18')
  ),
  ARRAY['961103c5-74be-4357-8573-c73862cb09b2','96d0fb31-9951-408d-a83e-b2937f5a6af8']
);
