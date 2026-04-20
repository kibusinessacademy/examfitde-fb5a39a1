-- Re-enqueue der letzten 3 Pakete, die durch den alten Guard gefailt wurden
INSERT INTO public.job_queue (job_type, status, package_id, payload, worker_pool, priority, meta)
SELECT
  'package_auto_generate_seo_suite',
  'pending',
  cp.id,
  jsonb_build_object(
    'package_id', cp.id,
    'curriculum_id', cp.curriculum_id,
    'reason', 'final_replay_after_guard_fix_v2'
  ),
  'default',
  50,
  jsonb_build_object('source', 'final_replay_2026_04_20', 'reason', 'last_3_after_guard_fix')
FROM public.course_packages cp
WHERE cp.id IN (
  '268c2982-a844-49c7-9b3c-2eafe611d299',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  'be7aa766-af51-445d-83d5-100a54007b39'
)
AND NOT EXISTS (
  SELECT 1 FROM public.job_queue jq2
  WHERE jq2.job_type = 'package_auto_generate_seo_suite'
    AND jq2.package_id = cp.id
    AND jq2.status IN ('pending','processing','completed')
);