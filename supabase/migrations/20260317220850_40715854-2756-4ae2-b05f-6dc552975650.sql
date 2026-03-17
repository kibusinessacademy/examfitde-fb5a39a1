
-- Create correctly-typed validation jobs
INSERT INTO job_queue (job_type, status, payload, priority, run_after)
VALUES 
  ('package_validate_exam_pool', 'pending', 
   jsonb_build_object(
     'package_id', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
     'course_id', '99f85640-3e23-4672-840b-7e80966db82e',
     'curriculum_id', 'e06a570a-d810-410d-873a-c87229465f41'
   ), 1, now()),
  ('package_validate_exam_pool', 'pending',
   jsonb_build_object(
     'package_id', '2e8da39f-60f8-44d9-8b70-e1176222ca55',
     'course_id', '6e0a20c0-918a-416b-a448-89f94908caa6',
     'curriculum_id', 'e24f7b10-0740-4729-8abe-e10fe765f6db'
   ), 1, now());

-- Also create integrity check and auto-publish jobs for after validation
INSERT INTO job_queue (job_type, status, payload, priority, run_after)
VALUES 
  ('run_integrity_check', 'pending', 
   jsonb_build_object('package_id', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'course_id', '99f85640-3e23-4672-840b-7e80966db82e', 'curriculum_id', 'e06a570a-d810-410d-873a-c87229465f41'),
   1, now() + interval '10 minutes'),
  ('run_integrity_check', 'pending',
   jsonb_build_object('package_id', '2e8da39f-60f8-44d9-8b70-e1176222ca55', 'course_id', '6e0a20c0-918a-416b-a448-89f94908caa6', 'curriculum_id', 'e24f7b10-0740-4729-8abe-e10fe765f6db'),
   1, now() + interval '10 minutes'),
  ('package_auto_publish', 'pending',
   jsonb_build_object('package_id', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'course_id', '99f85640-3e23-4672-840b-7e80966db82e', 'curriculum_id', 'e06a570a-d810-410d-873a-c87229465f41'),
   1, now() + interval '20 minutes'),
  ('package_auto_publish', 'pending',
   jsonb_build_object('package_id', '2e8da39f-60f8-44d9-8b70-e1176222ca55', 'course_id', '6e0a20c0-918a-416b-a448-89f94908caa6', 'curriculum_id', 'e24f7b10-0740-4729-8abe-e10fe765f6db'),
   1, now() + interval '20 minutes');
