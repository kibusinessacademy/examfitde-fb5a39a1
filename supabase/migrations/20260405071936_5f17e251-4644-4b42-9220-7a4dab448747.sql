
-- Claimability audit view: shows WHY each pending job can/cannot be claimed
CREATE OR REPLACE VIEW public.v_ops_job_claimability AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  jq.package_id,
  cp.track,
  cp.status AS pkg_status,
  jq.status AS job_status,
  jq.attempts,
  jq.run_after,
  jq.locked_by,
  jq.created_at,
  round(extract(epoch FROM (now() - jq.created_at)) / 3600.0, 1) AS age_hours,
  -- Claimability assessment
  CASE
    WHEN jq.locked_by IS NOT NULL THEN false
    WHEN jq.run_after > now() THEN false
    WHEN cp.status NOT IN ('building', 'queued') THEN false
    WHEN jq.attempts >= 25 THEN false
    ELSE true
  END AS claimable_now,
  -- Block reason (first match)
  CASE
    WHEN jq.locked_by IS NOT NULL THEN 'locked_by_worker'
    WHEN jq.run_after > now() THEN 'future_run_after'
    WHEN cp.status NOT IN ('building', 'queued') THEN 'wrong_pkg_status:' || coalesce(cp.status, 'NULL')
    WHEN jq.attempts >= 25 THEN 'exhausted_attempts'
    ELSE NULL
  END AS block_reason,
  -- Time until claimable (for future_run_after)
  CASE
    WHEN jq.run_after > now() THEN round(extract(epoch FROM (jq.run_after - now())) / 60.0, 1)
    ELSE 0
  END AS minutes_until_claimable
FROM job_queue jq
LEFT JOIN course_packages cp ON cp.id = jq.package_id
WHERE jq.status IN ('pending', 'queued', 'processing');

-- Worker liveness dashboard view
CREATE OR REPLACE VIEW public.v_ops_worker_liveness AS
SELECT
  count(*) FILTER (WHERE status = 'pending') AS pending_count,
  count(*) FILTER (WHERE status = 'processing') AS processing_count,
  count(*) FILTER (WHERE status = 'pending' AND run_after <= now() AND locked_by IS NULL) AS claimable_now,
  count(*) FILTER (WHERE status = 'pending' AND run_after > now()) AS future_blocked,
  min(created_at) FILTER (WHERE status = 'pending' AND run_after <= now() AND locked_by IS NULL) AS oldest_claimable_at,
  round(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'pending' AND run_after <= now() AND locked_by IS NULL))) / 3600.0, 1) AS oldest_claimable_hours,
  CASE
    WHEN count(*) FILTER (WHERE status = 'processing') = 0
     AND count(*) FILTER (WHERE status = 'pending' AND run_after <= now() AND locked_by IS NULL) > 10
    THEN true
    ELSE false
  END AS worker_pool_stalled
FROM job_queue
WHERE status IN ('pending', 'queued', 'processing');
