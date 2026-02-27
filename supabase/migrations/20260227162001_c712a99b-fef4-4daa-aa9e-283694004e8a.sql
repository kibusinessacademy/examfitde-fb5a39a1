
-- Add blocked_pending_ready to detail view + comment clarity
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
-- leases_active_no_work: only if renewed_at is older than 10min ago (i.e. idle for >10min)
-- or if renewed_at is NULL and lease_until is still >20min in the future (proxy for fresh-but-idle)
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
  )
UNION ALL
-- blocked_pending_ready: pending jobs marked artifact_blocked but whose run_after has passed
SELECT 'blocked_pending_ready', jq.id::text,
  jq.job_type, jq.updated_at,
  coalesce(jq.payload->>'package_id', jq.package_id::text)
FROM public.job_queue jq
WHERE jq.status = 'pending'
  AND (jq.meta->>'artifact_blocked')::boolean IS TRUE
  AND (jq.run_after IS NULL OR jq.run_after <= now());
