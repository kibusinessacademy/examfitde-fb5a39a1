
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit int DEFAULT 5,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fanout_cap int := 30;  -- TEMPORARY: raised from 3 to 30 to drain variant backlog
BEGIN
  RETURN QUERY
  WITH claimable_raw AS (
    SELECT jq.id, jq.job_type,
      ROW_NUMBER() OVER (
        PARTITION BY (jq.job_type = 'package_generate_blueprint_variants')
        ORDER BY jq.priority DESC NULLS LAST, jq.created_at ASC
      ) AS rn_fanout
    FROM job_queue jq
    LEFT JOIN course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
    ORDER BY jq.priority DESC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
  ),
  claimable AS (
    SELECT cr.id
    FROM claimable_raw cr
    WHERE NOT (
      cr.job_type = 'package_generate_blueprint_variants'
      AND cr.rn_fanout > v_fanout_cap
    )
    LIMIT p_limit
  )
  UPDATE job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM claimable c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;
