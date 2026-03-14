
-- Cancel all stuck ZERO_GENERATION retry-loop jobs for package 9c1b3734
UPDATE public.job_queue 
SET status = 'cancelled', 
    last_error = 'Loop guard v2: cancelled — ZERO_GENERATION retry loop'
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status IN ('pending', 'processing');

-- Set the step to blocked with loop guard meta
UPDATE public.package_steps
SET status = 'blocked',
    job_id = NULL,
    runner_id = NULL,
    last_error = 'LOOP_GUARD_v2: ZERO_GENERATION retry loop — 13 jobs, 0 questions produced',
    meta = jsonb_build_object(
      'loop_guard_blocked', true,
      'loop_guard_reason', 'ZERO_GENERATION retry loop',
      'loop_guard_blocked_at', now()::text,
      'zero_generation_streak', 13,
      'zero_progress_runs', 13
    )
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'generate_exam_pool';

-- Block the package
UPDATE public.course_packages
SET status = 'blocked',
    blocked_reason = 'loop_guard_generate_exam_pool',
    last_error = 'LOOP_GUARD_v2: ZERO_GENERATION retry loop blocked'
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c';
