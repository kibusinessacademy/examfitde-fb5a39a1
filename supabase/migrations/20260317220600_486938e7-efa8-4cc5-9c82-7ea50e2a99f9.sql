
-- Create validate_exam_pool jobs for both packages
INSERT INTO job_queue (job_type, status, payload, priority, run_after)
VALUES 
  ('validate_exam_pool', 'pending', 
   '{"package_id": "fd1d8192-a16f-496b-80c8-5e06f70ec21a", "course_id": "fd1d8192-a16f-496b-80c8-5e06f70ec21a", "curriculum_id": "e06a570a-d810-410d-873a-c87229465f41"}'::jsonb,
   1, now()),
  ('validate_exam_pool', 'pending',
   '{"package_id": "2e8da39f-60f8-44d9-8b70-e1176222ca55", "course_id": "2e8da39f-60f8-44d9-8b70-e1176222ca55", "curriculum_id": "e24f7b10-0740-4729-8abe-e10fe765f6db"}'::jsonb,
   1, now());
