
-- Fix: count_package_inflight_jobs should only count LESSON-level jobs, not the parent dispatcher job
CREATE OR REPLACE FUNCTION public.count_package_inflight_jobs(p_package_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.job_queue jq
  WHERE jq.status IN ('queued', 'pending', 'processing')
    AND jq.package_id = p_package_id
    AND jq.job_type IN ('lesson_generate_content', 'lesson_generate_competency_bundle');
$$;
