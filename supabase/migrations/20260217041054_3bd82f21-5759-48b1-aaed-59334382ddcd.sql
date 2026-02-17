
-- BUG FIX 1: step_fail must also handle 'timeout' status
-- Without this, timed-out steps can never transition to 'failed'
CREATE OR REPLACE FUNCTION public.step_fail(
  p_package_id uuid,
  p_step_key text,
  p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'failed',
      finished_at = now(),
      last_error = left(p_error, 4000)
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('running', 'enqueued', 'timeout');
$$;

-- BUG FIX 2: step_start must reset started_at on every retry
-- so the timeout calculation uses the CURRENT attempt start, not the original
CREATE OR REPLACE FUNCTION public.step_start(
  p_package_id uuid,
  p_step_key text,
  p_runner_id text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'running',
      attempts = attempts + 1,
      started_at = now(),
      last_heartbeat_at = now(),
      runner_id = p_runner_id,
      last_error = NULL
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('queued','failed','timeout','blocked','enqueued');
$$;

-- BUG FIX 3: Fix the 2 currently stuck steps where job completed but step not updated
-- Büromanagement: generate_learning_content running but job completed
UPDATE public.package_steps
SET status = 'done', finished_at = now(), job_id = NULL
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'generate_learning_content'
  AND status = 'running';

-- Bankkaufmann: auto_seed_exam_blueprints timeout but job completed  
UPDATE public.package_steps
SET status = 'done', finished_at = now(), job_id = NULL
WHERE package_id = 'c25f9ee0-518f-44d2-ac49-72f6731608a2'
  AND step_key = 'auto_seed_exam_blueprints'
  AND status = 'timeout';

-- BUG FIX 4: Sync build_progress for all active packages
UPDATE public.course_packages cp
SET build_progress = (
  SELECT ROUND((count(*) FILTER (WHERE ps.status IN ('done','skipped'))::numeric / NULLIF(count(*),0)) * 100)
  FROM package_steps ps
  WHERE ps.package_id = cp.id
)
WHERE cp.status IN ('building','queued','planning');
