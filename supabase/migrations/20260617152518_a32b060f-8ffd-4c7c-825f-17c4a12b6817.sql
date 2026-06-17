
-- =============================================================
-- Phase 1.4: Cron Health Full View + Audit
-- =============================================================

CREATE TABLE IF NOT EXISTS public.cron_health_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  job_name text NOT NULL,
  schedule text,
  active boolean,
  command_excerpt text,
  run_count_24h integer NOT NULL DEFAULT 0,
  success_count_24h integer NOT NULL DEFAULT 0,
  fail_count_24h integer NOT NULL DEFAULT 0,
  p50_ms integer,
  p95_ms integer,
  max_ms integer,
  last_status text,
  last_run_at timestamptz,
  health text NOT NULL DEFAULT 'unknown',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_health_audit_snapshot ON public.cron_health_audit (snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_health_audit_job ON public.cron_health_audit (job_name, snapshot_at DESC);

GRANT SELECT ON public.cron_health_audit TO authenticated;
GRANT ALL ON public.cron_health_audit TO service_role;
ALTER TABLE public.cron_health_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read cron_health_audit"
  ON public.cron_health_audit FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "service_role manages cron_health_audit"
  ON public.cron_health_audit FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------- v_admin_cron_health_full (live join) ----------
CREATE OR REPLACE VIEW public.v_admin_cron_health_full AS
WITH runs AS (
  SELECT
    j.jobname AS job_name,
    COUNT(*) FILTER (WHERE r.start_time >= now() - interval '24 hours') AS run_count_24h,
    COUNT(*) FILTER (WHERE r.start_time >= now() - interval '24 hours' AND r.status = 'succeeded') AS success_count_24h,
    COUNT(*) FILTER (WHERE r.start_time >= now() - interval '24 hours' AND r.status = 'failed') AS fail_count_24h,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000) FILTER (WHERE r.start_time >= now() - interval '24 hours' AND r.end_time IS NOT NULL) AS p50_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000) FILTER (WHERE r.start_time >= now() - interval '24 hours' AND r.end_time IS NOT NULL) AS p95_ms,
    MAX(EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000) FILTER (WHERE r.start_time >= now() - interval '24 hours' AND r.end_time IS NOT NULL) AS max_ms
  FROM cron.job j
  LEFT JOIN cron.job_run_details r ON r.jobid = j.jobid
  GROUP BY j.jobname
),
latest AS (
  SELECT DISTINCT ON (j.jobname)
    j.jobname AS job_name,
    r.status AS last_status,
    r.start_time AS last_run_at,
    r.return_message AS last_message
  FROM cron.job j
  LEFT JOIN cron.job_run_details r ON r.jobid = j.jobid
  ORDER BY j.jobname, r.start_time DESC NULLS LAST
)
SELECT
  j.jobid,
  j.jobname AS job_name,
  j.schedule,
  j.active,
  LEFT(j.command, 200) AS command_excerpt,
  COALESCE(runs.run_count_24h, 0)::int AS run_count_24h,
  COALESCE(runs.success_count_24h, 0)::int AS success_count_24h,
  COALESCE(runs.fail_count_24h, 0)::int AS fail_count_24h,
  runs.p50_ms::int AS p50_ms,
  runs.p95_ms::int AS p95_ms,
  runs.max_ms::int AS max_ms,
  latest.last_status,
  latest.last_run_at,
  latest.last_message,
  CASE
    WHEN NOT j.active THEN 'disabled'
    WHEN latest.last_run_at IS NULL THEN 'never_ran'
    WHEN latest.last_status = 'failed' THEN 'last_run_failed'
    WHEN COALESCE(runs.fail_count_24h, 0) > 0 AND COALESCE(runs.run_count_24h, 0) > 0
         AND (runs.fail_count_24h::float / runs.run_count_24h) > 0.2 THEN 'degraded'
    WHEN latest.last_run_at < now() - interval '6 hours' AND j.schedule LIKE '%minute%' THEN 'lagging'
    ELSE 'healthy'
  END AS health
FROM cron.job j
LEFT JOIN runs ON runs.job_name = j.jobname
LEFT JOIN latest ON latest.job_name = j.jobname;

REVOKE ALL ON public.v_admin_cron_health_full FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_cron_health_full TO service_role;

-- ---------- Admin RPC wrapper for the view (security_definer) ----------
CREATE OR REPLACE FUNCTION public.admin_get_cron_health_full()
RETURNS TABLE (
  job_name text, schedule text, active boolean, command_excerpt text,
  run_count_24h int, success_count_24h int, fail_count_24h int,
  p50_ms int, p95_ms int, max_ms int,
  last_status text, last_run_at timestamptz, last_message text, health text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.job_name, v.schedule, v.active, v.command_excerpt,
    v.run_count_24h, v.success_count_24h, v.fail_count_24h,
    v.p50_ms, v.p95_ms, v.max_ms,
    v.last_status, v.last_run_at, v.last_message, v.health
  FROM public.v_admin_cron_health_full v
  WHERE has_role(auth.uid(), 'admin'::app_role)
  ORDER BY
    CASE v.health
      WHEN 'last_run_failed' THEN 0
      WHEN 'degraded' THEN 1
      WHEN 'never_ran' THEN 2
      WHEN 'lagging' THEN 3
      WHEN 'disabled' THEN 4
      ELSE 5
    END,
    v.job_name;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_cron_health_full() TO authenticated;

-- ---------- Snapshot function (called hourly by cron) ----------
CREATE OR REPLACE FUNCTION public.fn_snapshot_cron_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_snap timestamptz := now();
BEGIN
  INSERT INTO public.cron_health_audit (
    snapshot_at, job_name, schedule, active, command_excerpt,
    run_count_24h, success_count_24h, fail_count_24h,
    p50_ms, p95_ms, max_ms, last_status, last_run_at, health
  )
  SELECT
    v_snap, v.job_name, v.schedule, v.active, v.command_excerpt,
    v.run_count_24h, v.success_count_24h, v.fail_count_24h,
    v.p50_ms, v.p95_ms, v.max_ms, v.last_status, v.last_run_at, v.health
  FROM public.v_admin_cron_health_full v;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- audit trail
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'cron_health_snapshot', 'system', to_char(v_snap, 'YYYY-MM-DD-HH24'),
    'success',
    jsonb_build_object('snapshot_at', v_snap, 'jobs_recorded', v_inserted)
  );

  -- retention: keep 14 days
  DELETE FROM public.cron_health_audit
   WHERE snapshot_at < now() - interval '14 days';

  RETURN jsonb_build_object('snapshot_at', v_snap, 'jobs_recorded', v_inserted);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_snapshot_cron_health() TO service_role;

-- =============================================================
-- Phase 2: GitHub Workflow Registry
-- =============================================================

CREATE TABLE IF NOT EXISTS public.github_workflow_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  file_path text NOT NULL,
  display_name text,
  triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  jobs jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_cron text[],
  permissions jsonb,
  file_bytes integer NOT NULL DEFAULT 0,
  loc integer NOT NULL DEFAULT 0,
  sha text,
  cluster text,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_wf_cluster ON public.github_workflow_registry (cluster);
CREATE INDEX IF NOT EXISTS idx_gh_wf_active ON public.github_workflow_registry (is_active);

GRANT SELECT ON public.github_workflow_registry TO authenticated;
GRANT ALL ON public.github_workflow_registry TO service_role;
ALTER TABLE public.github_workflow_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read github_workflow_registry"
  ON public.github_workflow_registry FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "service_role manages github_workflow_registry"
  ON public.github_workflow_registry FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_github_workflow_registry_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_gh_wf_updated_at ON public.github_workflow_registry;
CREATE TRIGGER trg_gh_wf_updated_at
  BEFORE UPDATE ON public.github_workflow_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_github_workflow_registry_updated_at();

-- Admin overview RPC
CREATE OR REPLACE FUNCTION public.admin_get_github_workflow_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE is_active),
    'scheduled', COUNT(*) FILTER (WHERE schedule_cron IS NOT NULL AND array_length(schedule_cron,1) > 0),
    'pr_triggered', COUNT(*) FILTER (WHERE triggers ? 'pull_request'),
    'push_triggered', COUNT(*) FILTER (WHERE triggers ? 'push'),
    'manual_only', COUNT(*) FILTER (WHERE jsonb_array_length(triggers) = 1 AND triggers ? 'workflow_dispatch'),
    'total_bytes', COALESCE(SUM(file_bytes), 0),
    'total_loc', COALESCE(SUM(loc), 0),
    'last_sync', MAX(last_synced_at),
    'clusters', (
      SELECT jsonb_object_agg(cluster, n)
      FROM (SELECT COALESCE(cluster,'_uncategorized') AS cluster, COUNT(*) AS n
            FROM public.github_workflow_registry GROUP BY 1) c
    )
  ) INTO v
  FROM public.github_workflow_registry;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_get_github_workflow_overview() TO authenticated;

-- ---------- Audit trail ----------
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'cron_workflow_phase_1_4_and_2', 'system', 'cron_consolidation_2026_06_17',
  'success',
  jsonb_build_object(
    'phase', 'phase_1_4_cron_health_audit + phase_2_github_workflow_registry',
    'added', jsonb_build_array(
      'cron_health_audit table',
      'v_admin_cron_health_full view',
      'admin_get_cron_health_full RPC',
      'fn_snapshot_cron_health function',
      'github_workflow_registry table',
      'admin_get_github_workflow_overview RPC'
    )
  )
);
