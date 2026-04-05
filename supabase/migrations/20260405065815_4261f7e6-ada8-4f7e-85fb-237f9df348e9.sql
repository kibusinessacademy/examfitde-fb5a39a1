
-- FIX 1: Lagerlogistik — variant steps already inserted by previous partial migration
-- Enqueue variant job (if not exists)
INSERT INTO public.job_queue (job_type, package_id, status, payload, max_attempts, priority)
SELECT 'package_generate_blueprint_variants',
  'f2039067-e58a-4e94-9573-b5953d435873', 'pending',
  jsonb_build_object(
    'package_id','f2039067-e58a-4e94-9573-b5953d435873',
    'curriculum_id','516618c7-ba4d-4e1a-bee6-b609b513ebd3',
    'course_id', (SELECT course_id::text FROM course_packages WHERE id = 'f2039067-e58a-4e94-9573-b5953d435873')
  ), 10, 2
WHERE NOT EXISTS (
  SELECT 1 FROM public.job_queue
  WHERE package_id = 'f2039067-e58a-4e94-9573-b5953d435873'
    AND job_type = 'package_generate_blueprint_variants'
    AND status IN ('pending','queued','processing')
);

-- FIX 2: Wirtschaftsinformatik — already applied by partial migration
-- FIX 3: BWL Bachelor — already applied

-- FIX 4: Bilanzbuchhalter — skip steps already applied
-- Cancel duplicate handbook jobs, keep only the pending one
UPDATE public.job_queue SET status = 'cancelled'
WHERE package_id = 'eef4bbe6-6c92-4969-941e-af471e86d67f'
  AND job_type = 'package_generate_handbook'
  AND status = 'failed';

-- Reset the remaining pending one
UPDATE public.job_queue
SET updated_at = now(), run_after = now()
WHERE id = '2784f379-1b16-4947-a77b-d1d578f8f328';

-- FIX 5: Industriekaufmann — already applied

-- FIX 6: Bump all stale pending jobs
UPDATE public.job_queue
SET updated_at = now(), run_after = now()
WHERE status = 'pending'
  AND created_at < now() - interval '2 hours'
  AND locked_by IS NULL;

-- FIX 1b: Unblock Lagerlogistik
UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id = 'f2039067-e58a-4e94-9573-b5953d435873' AND status = 'blocked';
