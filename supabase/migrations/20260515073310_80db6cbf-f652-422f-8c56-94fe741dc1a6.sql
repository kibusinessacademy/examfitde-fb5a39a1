UPDATE package_steps
   SET status='queued', last_error=NULL, updated_at=now()
 WHERE package_id='adce63f4-03ba-49ec-964c-c35e3984a591'
   AND step_key='auto_publish'
   AND status='failed';

INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
VALUES (
  'publish_tail_job_requeued','course_package','adce63f4-03ba-49ec-964c-c35e3984a591','success',
  'Targeted JOB_FAILED_RETRIABLE heal: reset auto_publish step → queued (auto-enqueue via pipeline trigger)',
  jsonb_build_object('root_cause','JOB_FAILED_RETRIABLE','invoked_by','lovable_publish_tail_targeted_run','strategy','step_reset_only')
);

INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
VALUES (
  'publish_tail_reconciled','system','success',
  'Targeted reconciler run: healed=1 unresolved=2 dry_run=false',
  jsonb_build_object('dry_run',false,'healed',1,'unresolved',2,'skipped',0,
    'targeted_package','adce63f4-03ba-49ec-964c-c35e3984a591',
    'unresolved_packages', jsonb_build_array(
      jsonb_build_object('package_id','59b6e214-e181-4c2b-986e-1ce544984d04','title','Verkäufer/-in','reason','GUARD_MATRIX_MISMATCH'),
      jsonb_build_object('package_id','a9f19137-a004-4850-838a-bdc8f8a705f5','title','Steuerfachangestellter/-in','reason','BRONZE_LOCKED')
    ))
);