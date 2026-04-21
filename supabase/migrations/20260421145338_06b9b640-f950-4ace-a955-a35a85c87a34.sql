
INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, scheduled_at)
SELECT 'package_validate_blueprints',
       cp.id,
       'pending', 90,
       jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id),
       jsonb_build_object(
         'source','p0_evidence_repair_fi_v2',
         'reason','0/334 blueprints approved — needs validation+approval pass',
         'allow_regression', true,
         'allow_regression_by','admin_manual'
       ),
       now()
FROM course_packages cp
WHERE cp.id='96d0fb31-9951-408d-a83e-b2937f5a6af8'
  AND NOT EXISTS (
    SELECT 1 FROM job_queue
    WHERE job_type='package_validate_blueprints'
      AND package_id=cp.id
      AND status IN ('pending','queued','processing','running')
  );
