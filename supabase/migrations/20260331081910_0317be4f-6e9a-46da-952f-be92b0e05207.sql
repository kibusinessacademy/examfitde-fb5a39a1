
-- Fix blocked hotel package: reset pipeline steps for re-generation
UPDATE package_steps 
SET status = 'queued', started_at = NULL, finished_at = NULL, last_error = 'ADMIN_RESET: insufficient pool (30/500), re-generating'
WHERE package_id = 'b071710f-4079-4683-847f-e4748962d7f5'
AND step_key IN ('generate_exam_pool', 'validate_exam_pool', 'elite_harden', 'run_integrity_check', 'quality_council', 'auto_publish');

-- Unblock the package, set to building
UPDATE course_packages 
SET status = 'building', blocked_reason = NULL, updated_at = now()
WHERE id = 'b071710f-4079-4683-847f-e4748962d7f5';

-- Enqueue a new exam pool generation job (status default is 'pending')
INSERT INTO job_queue (job_type, package_id, priority, payload)
VALUES ('package_generate_exam_pool', 'b071710f-4079-4683-847f-e4748962d7f5', 20,
  jsonb_build_object('curriculum_id', '6e9c11f2-2381-4d3a-89ff-5086b7b0569a', 'triggered_by', 'admin_unblock_reset'));

-- Log the admin action
INSERT INTO auto_heal_log (action_type, result_status, metadata)
VALUES ('admin_unblock_hotel_package', 'applied', jsonb_build_object(
  'package_id', 'b071710f-4079-4683-847f-e4748962d7f5',
  'reason', 'Only 30 approved questions, need 500. Reset pipeline for re-generation.',
  'steps_reset', ARRAY['generate_exam_pool','validate_exam_pool','elite_harden','run_integrity_check','quality_council','auto_publish']
));
