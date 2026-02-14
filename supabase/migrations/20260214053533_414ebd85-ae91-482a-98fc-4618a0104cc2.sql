-- First: clean up existing duplicate pending/processing jobs (keep oldest per curriculum+type)
DELETE FROM public.job_queue
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY job_type, (payload->>'curriculum_id')
             ORDER BY created_at ASC
           ) AS rn
    FROM public.job_queue
    WHERE status IN ('pending', 'processing')
      AND payload ? 'curriculum_id'
  ) dupes
  WHERE rn > 1
);

-- Clean up duplicate package jobs
DELETE FROM public.job_queue
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY job_type, (payload->>'package_id')
             ORDER BY created_at ASC
           ) AS rn
    FROM public.job_queue
    WHERE status IN ('pending', 'processing')
      AND payload ? 'package_id'
  ) dupes
  WHERE rn > 1
);

-- Prevent future duplicate curriculum jobs (pending/processing)
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobqueue_curriculum_jobtype_active
ON public.job_queue (
  job_type,
  ((payload->>'curriculum_id'))
)
WHERE status IN ('pending', 'processing')
  AND payload ? 'curriculum_id';

-- Prevent future duplicate package jobs (pending/processing)
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobqueue_package_jobtype_active
ON public.job_queue (
  job_type,
  ((payload->>'package_id'))
)
WHERE status IN ('pending', 'processing')
  AND payload ? 'package_id';