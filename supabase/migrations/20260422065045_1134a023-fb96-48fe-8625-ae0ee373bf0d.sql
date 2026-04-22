
UPDATE package_steps
   SET status='queued', last_error=NULL, started_at=NULL, finished_at=NULL,
       meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
         'allow_regression',true,'allow_regression_by','admin_manual',
         'reset_by','manual_heal_v1','reset_reason','false_positive_no_curriculum')
 WHERE package_id='176f51ad-fe34-596e-9b3d-d1c9cd23b0a9'
   AND step_key IN ('validate_exam_pool','repair_exam_pool_quality');

UPDATE course_packages
   SET status='building', blocked_reason=NULL, updated_at=now()
 WHERE id='176f51ad-fe34-596e-9b3d-d1c9cd23b0a9';
