SET LOCAL session_replication_role = 'replica';

UPDATE package_steps
SET status = 'queued',
    updated_at = now()
WHERE package_id = 'dd000001-0008-4000-8000-000000000001'
  AND step_key IN ('validate_exam_pool','validate_tutor_index','run_integrity_check','quality_council','auto_publish')
  AND status = 'skipped';

INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
VALUES ('handelsfachwirt_tail_manual_reactivation','package','dd000001-0008-4000-8000-000000000001','ok',
  jsonb_build_object('steps', ARRAY['validate_exam_pool','validate_tutor_index','run_integrity_check','quality_council','auto_publish'],
                     'reason','exam_pool_done_469_approved_phantom_skip_revert'));

SELECT admin_nudge_atomic_trigger('dd000001-0008-4000-8000-000000000001'::uuid, false) AS nudge;