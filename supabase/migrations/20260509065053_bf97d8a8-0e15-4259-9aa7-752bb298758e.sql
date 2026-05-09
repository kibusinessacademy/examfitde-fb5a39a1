
-- =========================================================================
-- S5c: Nightly aggregate-state audit with diff
-- =========================================================================

-- 1) Storage table for snapshots
CREATE TABLE IF NOT EXISTS public.ops_aggregate_state_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL DEFAULT 'nightly',
  bucket jsonb NOT NULL,           -- {package_id, job_type, lane, pool, track, claim_state}
  n integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_agg_state_audit_run_at
  ON public.ops_aggregate_state_audit(run_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_agg_state_audit_bucket_gin
  ON public.ops_aggregate_state_audit USING GIN (bucket);

ALTER TABLE public.ops_aggregate_state_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_agg_state_audit_admin_read" ON public.ops_aggregate_state_audit;
CREATE POLICY "ops_agg_state_audit_admin_read"
  ON public.ops_aggregate_state_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Snapshot RPC: aggregates current state and writes a snapshot
CREATE OR REPLACE FUNCTION public.fn_capture_aggregate_state_snapshot(p_scope text DEFAULT 'nightly')
RETURNS TABLE(rows_written integer, run_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_at timestamptz := now();
  v_count  integer := 0;
BEGIN
  WITH agg AS (
    SELECT
      jq.package_id,
      jq.job_type,
      COALESCE(jq.lane, 'default')        AS lane,
      COALESCE(jq.worker_pool, 'default') AS pool,
      COALESCE(cp.track, 'unknown')       AS track,
      CASE
        WHEN jq.status = 'processing' AND jq.last_heartbeat_at IS NULL THEN 'PROCESSING_WITHOUT_HEARTBEAT'
        WHEN jq.status = 'processing' THEN 'PROCESSING_WITH_HEARTBEAT'
        WHEN jq.status = 'pending' AND jq.run_after > now() THEN 'PENDING_DEFERRED'
        WHEN jq.status = 'pending' AND COALESCE(jq.run_after, now()) <= now() THEN 'PENDING_CLAIMABLE'
        WHEN jq.status = 'failed' THEN 'FAILED'
        WHEN jq.status = 'completed' THEN 'DONE'
        WHEN jq.status = 'cancelled' THEN 'CANCELLED'
        ELSE jq.status
      END AS claim_state,
      count(*)::int AS n
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp ON cp.id = jq.package_id
    WHERE COALESCE(jq.updated_at, jq.created_at) > now() - interval '24 hours'
    GROUP BY 1,2,3,4,5,6
  )
  INSERT INTO public.ops_aggregate_state_audit (run_at, scope, bucket, n)
  SELECT
    v_run_at,
    p_scope,
    jsonb_build_object(
      'package_id', package_id,
      'job_type',   job_type,
      'lane',       lane,
      'pool',       pool,
      'track',      track,
      'claim_state', claim_state
    ),
    n
  FROM agg;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'aggregate_state_snapshot',
    'system',
    'ok',
    format('captured %s buckets', v_count),
    jsonb_build_object('scope', p_scope, 'run_at', v_run_at, 'rows', v_count)
  );

  RETURN QUERY SELECT v_count, v_run_at;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_capture_aggregate_state_snapshot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_capture_aggregate_state_snapshot(text) TO service_role;

-- 3) Diff RPC: latest two snapshots compared (admin only)
CREATE OR REPLACE FUNCTION public.admin_get_aggregate_state_diff(p_scope text DEFAULT 'nightly')
RETURNS TABLE(
  bucket jsonb,
  prev_n integer,
  curr_n integer,
  delta  integer,
  prev_run_at timestamptz,
  curr_run_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curr timestamptz;
  v_prev timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT DISTINCT a.run_at INTO v_curr
  FROM public.ops_aggregate_state_audit a
  WHERE a.scope = p_scope
  ORDER BY a.run_at DESC
  LIMIT 1;

  SELECT DISTINCT a.run_at INTO v_prev
  FROM public.ops_aggregate_state_audit a
  WHERE a.scope = p_scope AND a.run_at < v_curr
  ORDER BY a.run_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH curr AS (
    SELECT a.bucket, a.n FROM public.ops_aggregate_state_audit a
    WHERE a.scope = p_scope AND a.run_at = v_curr
  ),
  prev AS (
    SELECT a.bucket, a.n FROM public.ops_aggregate_state_audit a
    WHERE a.scope = p_scope AND a.run_at = v_prev
  )
  SELECT
    COALESCE(c.bucket, p.bucket)            AS bucket,
    COALESCE(p.n, 0)::int                   AS prev_n,
    COALESCE(c.n, 0)::int                   AS curr_n,
    (COALESCE(c.n,0) - COALESCE(p.n,0))::int AS delta,
    v_prev,
    v_curr
  FROM curr c
  FULL OUTER JOIN prev p ON p.bucket = c.bucket
  ORDER BY ABS(COALESCE(c.n,0) - COALESCE(p.n,0)) DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_aggregate_state_diff(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_aggregate_state_diff(text) TO authenticated;

-- 4) Nightly cron at 03:17 UTC
DO $$
BEGIN
  PERFORM cron.unschedule('aggregate-state-nightly-audit');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'aggregate-state-nightly-audit',
  '17 3 * * *',
  $$ SELECT public.fn_capture_aggregate_state_snapshot('nightly'); $$
);
