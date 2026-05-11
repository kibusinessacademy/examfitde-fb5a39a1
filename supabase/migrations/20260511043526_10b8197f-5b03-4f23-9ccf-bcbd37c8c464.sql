
DROP VIEW IF EXISTS public.v_phantom_building_packages CASCADE;

CREATE VIEW public.v_phantom_building_packages AS
SELECT
  cp.id              AS package_id,
  cp.package_key,
  cp.status,
  cp.build_progress,
  cp.updated_at      AS package_updated_at,
  COALESCE(cp.feature_flags->'bronze'->>'locked','false')::bool AS bronze_locked,
  (
    SELECT MAX(j.updated_at) FROM public.job_queue j
    WHERE j.package_id = cp.id
      AND j.status IN ('processing','queued','pending')
  ) AS last_active_job_at,
  (
    SELECT COUNT(*) FROM public.exam_questions q
    WHERE q.package_id = cp.id AND q.status='approved'
  ) AS approved_questions
FROM public.course_packages cp
WHERE cp.status = 'building'
  AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_active_packages pap
    WHERE pap.package_id = cp.id AND pap.heartbeat_at > now() - interval '10 minutes'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.job_queue j
    WHERE j.package_id = cp.id
      AND j.status IN ('processing','queued','pending')
      AND j.updated_at > now() - interval '6 hours'
  )
  AND COALESCE(cp.build_progress, 0) < 70
  AND (
    SELECT COUNT(*) FROM public.exam_questions q
    WHERE q.package_id = cp.id AND q.status='approved'
  ) < 50;

REVOKE ALL ON public.v_phantom_building_packages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_phantom_building_packages TO service_role;
