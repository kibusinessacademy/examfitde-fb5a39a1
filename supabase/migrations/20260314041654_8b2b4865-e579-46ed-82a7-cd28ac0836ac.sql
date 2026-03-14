
-- Cancel any old stale minicheck jobs
UPDATE job_queue
SET status = 'cancelled', updated_at = now(), error = 'stale: replaced by hardened v2'
WHERE job_type IN ('package_generate_lesson_minichecks', 'package_validate_lesson_minichecks')
  AND status IN ('pending', 'processing');

-- Create fresh jobs for the 4 actively building packages
INSERT INTO job_queue (job_type, package_id, payload, priority, status) VALUES
  ('package_generate_lesson_minichecks', '9c1b3734-bb25-4986-baef-5bb1c20a212c',
   '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","course_id":"235f622e-6046-487e-8465-e1ab7daae252"}'::jsonb, 5, 'pending'),
  ('package_generate_lesson_minichecks', '2e8da39f-60f8-44d9-8b70-e1176222ca55',
   '{"package_id":"2e8da39f-60f8-44d9-8b70-e1176222ca55","curriculum_id":"e24f7b10-0740-4729-8abe-e10fe765f6db","course_id":"6e0a20c0-918a-416b-a448-89f94908caa6"}'::jsonb, 5, 'pending'),
  ('package_generate_lesson_minichecks', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
   '{"package_id":"fd1d8192-a16f-496b-80c8-5e06f70ec21a","curriculum_id":"e06a570a-d810-410d-873a-c87229465f41","course_id":"99f85640-3e23-4672-840b-7e80966db82e"}'::jsonb, 5, 'pending'),
  ('package_generate_lesson_minichecks', '59b6e214-e181-4c2b-986e-1ce544984d04',
   '{"package_id":"59b6e214-e181-4c2b-986e-1ce544984d04","curriculum_id":"63635f46-0186-49e7-80c1-67925dbdf638","course_id":"ae943f8c-da2e-422e-af5f-d7ff721cbf0c"}'::jsonb, 5, 'pending');

-- Reset step meta to clear any stale stall counters
UPDATE package_steps
SET meta = '{}'::jsonb, started_at = NULL, finished_at = NULL
WHERE step_key = 'generate_lesson_minichecks'
  AND package_id IN (
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
    '59b6e214-e181-4c2b-986e-1ce544984d04'
  );
