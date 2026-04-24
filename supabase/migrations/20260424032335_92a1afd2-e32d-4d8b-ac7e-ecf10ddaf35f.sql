DO $mig$
DECLARE v_job uuid := '43be1fbc-bbc9-4b07-b2f3-805718dc2a04'::uuid;
BEGIN
  UPDATE public.job_queue
     SET status='cancelled',
         last_error='Admin: ghost-finalization zombie cleared (5h stale, attempts=7, step run_integrity_check never started)',
         locked_by=NULL, locked_at=NULL, completed_at=now(), updated_at=now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('admin_cancel_reason','ghost_finalization_zombie','admin_cancel_at', now(),'admin_cancel_source','manual_user_request_2026-04-24')
   WHERE id=v_job AND status='processing';

  INSERT INTO public.admin_actions(action,payload,scope,affected_ids,created_at)
  VALUES('force_cancel_zombie_integrity_job',
         jsonb_build_object('job_id',v_job::text,'job_type','package_run_integrity_check','package_id','10eee221-dd82-4b45-9ffd-e927c1c3c3b2','attempts_at_cancel',7,'reason','ghost_finalization_5h_stale','step','run_integrity_check','source','manual_user_request_2026-04-24'),
         'job_queue', ARRAY[v_job::text], now());
END
$mig$;
-- end