
-- Robusterer leases_active_no_work: renewed_at + lease_until proxy
CREATE OR REPLACE VIEW public.ops_runner_integrity AS
SELECT
  now() AS as_of,
  (SELECT count(*) FROM public.package_leases pl
   JOIN public.course_packages cp ON cp.id = pl.package_id
   WHERE pl.lease_until > now() AND cp.status <> 'building') AS orphan_leases,
  (SELECT count(*) FROM public.job_queue jq
   LEFT JOIN public.course_packages cp ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
   WHERE jq.status = 'pending' AND cp.id IS NOT NULL AND cp.status <> 'building') AS pending_non_building,
  (SELECT count(*) FROM public.job_queue jq
   LEFT JOIN public.course_packages cp ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
   WHERE jq.status = 'processing' AND cp.id IS NOT NULL AND cp.status <> 'building') AS processing_non_building,
  (SELECT count(*) FROM public.job_queue jq
   WHERE jq.status = 'processing' AND jq.started_at IS NOT NULL
     AND jq.started_at < now() - interval '10 minutes') AS stuck_processing_10m,
  (SELECT count(*) FROM public.job_queue jq
   WHERE jq.status = 'pending'
     AND (jq.meta->>'artifact_blocked')::boolean IS TRUE
     AND (jq.run_after IS NULL OR jq.run_after <= now())) AS blocked_pending_ready,
  (SELECT count(*) FROM public.job_queue jq
   WHERE jq.status IN ('pending','processing')
     AND (jq.package_id IS NOT NULL OR jq.payload->>'package_id' IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.course_packages cp
       WHERE cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
     )) AS dangling_jobs_no_package,
  (SELECT count(*) FROM public.package_leases pl
   JOIN public.course_packages cp ON cp.id = pl.package_id
   WHERE pl.lease_until > now()
     AND cp.status = 'building'
     AND (
       (pl.renewed_at IS NOT NULL AND pl.renewed_at < now() - interval '10 minutes')
       OR (pl.renewed_at IS NULL AND pl.lease_until > now() + interval '20 minutes')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.job_queue jq
       WHERE jq.status IN ('pending','processing')
         AND (jq.package_id = pl.package_id
           OR (jq.payload->>'package_id') = pl.package_id::text)
     )) AS leases_active_no_work;

-- Same fix in detail view
CREATE OR REPLACE VIEW public.ops_runner_integrity_details AS
SELECT 'orphan_leases'::text AS category, pl.package_id::text AS ref_id,
  cp.status AS package_status, pl.lease_until AS ts, pl.runner_id AS info
FROM public.package_leases pl
JOIN public.course_packages cp ON cp.id = pl.package_id
WHERE pl.lease_until > now() AND cp.status <> 'building'
UNION ALL
SELECT 'pending_non_building', coalesce(jq.package_id::text, jq.payload->>'package_id'),
  cp.status, jq.updated_at, jq.job_type
FROM public.job_queue jq
LEFT JOIN public.course_packages cp ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
WHERE jq.status = 'pending' AND cp.id IS NOT NULL AND cp.status <> 'building'
UNION ALL
SELECT 'dangling_jobs_no_package', coalesce(jq.package_id::text, jq.payload->>'package_id'),
  null, jq.updated_at, jq.job_type
FROM public.job_queue jq
WHERE jq.status IN ('pending','processing')
  AND (jq.package_id IS NOT NULL OR jq.payload->>'package_id' IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.course_packages cp
    WHERE cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
  )
UNION ALL
SELECT 'leases_active_no_work', pl.package_id::text,
  cp.status, pl.lease_until, pl.runner_id
FROM public.package_leases pl
JOIN public.course_packages cp ON cp.id = pl.package_id
WHERE pl.lease_until > now()
  AND cp.status = 'building'
  AND (
    (pl.renewed_at IS NOT NULL AND pl.renewed_at < now() - interval '10 minutes')
    OR (pl.renewed_at IS NULL AND pl.lease_until > now() + interval '20 minutes')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.job_queue jq
    WHERE jq.status IN ('pending','processing')
      AND (jq.package_id = pl.package_id
        OR (jq.payload->>'package_id') = pl.package_id::text)
  );
