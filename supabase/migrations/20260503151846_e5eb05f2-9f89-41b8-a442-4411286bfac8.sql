
-- 1) Run-History-Tabelle
CREATE TABLE IF NOT EXISTS public.coupling_heal_v4_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  -- succeeded | skipped | failed_transient | failed_structural | crashed | retried_succeeded
  status text NOT NULL,
  processed_count integer NOT NULL DEFAULT 0,
  healed_count integer NOT NULL DEFAULT 0,
  errors_count integer NOT NULL DEFAULT 0,
  sqlstate text,
  error_message text,
  forensics jsonb NOT NULL DEFAULT '{}'::jsonb,
  retry_of uuid REFERENCES public.coupling_heal_v4_runs(id) ON DELETE SET NULL,
  triggered_by text NOT NULL DEFAULT 'cron'
);

CREATE INDEX IF NOT EXISTS idx_coupling_heal_v4_runs_started_desc
  ON public.coupling_heal_v4_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupling_heal_v4_runs_status
  ON public.coupling_heal_v4_runs (status, started_at DESC);

ALTER TABLE public.coupling_heal_v4_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_coupling_runs" ON public.coupling_heal_v4_runs;
CREATE POLICY "admins_read_coupling_runs"
  ON public.coupling_heal_v4_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Realtime
ALTER TABLE public.coupling_heal_v4_runs REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND tablename='coupling_heal_v4_runs';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.coupling_heal_v4_runs';
  END IF;
END $$;

-- 2) Forensik-Helper (gap-sync, mismatch, schema-drift)
CREATE OR REPLACE FUNCTION public.fn_coupling_heal_v4_forensics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gap_sync int;
  v_mismatch int;
  v_drift jsonb;
BEGIN
  -- Gap-Sync: Steps queued, ohne aktiven Job, in building Pakets (sollte nach Heal sinken)
  SELECT COUNT(*) INTO v_gap_sync
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE ps.status = 'queued'
    AND cp.status = 'building'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = ps.package_id
        AND jq.job_type = 'package_' || ps.step_key::text
        AND jq.status IN ('pending','queued','processing','running','batch_pending')
    );

  -- Mismatch: Step done/skipped, aber Job noch pending/processing
  SELECT COUNT(*) INTO v_mismatch
  FROM package_steps ps
  JOIN job_queue jq ON jq.package_id = ps.package_id
                   AND jq.job_type = 'package_' || ps.step_key::text
  WHERE ps.status IN ('done','skipped')
    AND jq.status IN ('pending','queued','processing','running');

  -- Schema-Drift (best effort)
  BEGIN
    SELECT to_jsonb(public.check_schema_drift()) INTO v_drift;
  EXCEPTION WHEN OTHERS THEN
    v_drift := jsonb_build_object('error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'gap_sync_queued_no_job', v_gap_sync,
    'mismatch_done_step_open_job', v_mismatch,
    'schema_drift', v_drift,
    'measured_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_coupling_heal_v4_forensics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_coupling_heal_v4_forensics() TO service_role;

-- 3) Klassifizierer transient vs strukturell
CREATE OR REPLACE FUNCTION public.fn_classify_pg_error(_sqlstate text, _msg text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _sqlstate IN ('40001','40P01','55P03','57014','57P01','08006','08000','08003','08004','53300','53400')
      OR COALESCE(_msg,'') ILIKE '%deadlock%'
      OR COALESCE(_msg,'') ILIKE '%timeout%'
      OR COALESCE(_msg,'') ILIKE '%canceling statement%'
      OR COALESCE(_msg,'') ILIKE '%could not serialize%'
      OR COALESCE(_msg,'') ILIKE '%tuple%already modified%'
    THEN 'transient'
    ELSE 'structural'
  END;
$$;

-- 4) Supervisor — wraps admin_heal_step_job_coupling_v4 mit try/catch, Forensik, Alert, 1× Retry
CREATE OR REPLACE FUNCTION public.fn_run_coupling_heal_v4_supervised(_retry_of uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_t0 timestamptz := clock_timestamp();
  v_processed int := 0;
  v_healed int := 0;
  v_errors int := 0;
  v_status text := 'succeeded';
  v_sqlstate text;
  v_msg text;
  v_class text;
  v_forensics jsonb;
  v_retry_id uuid;
BEGIN
  INSERT INTO public.coupling_heal_v4_runs(id, started_at, status, retry_of, triggered_by)
  VALUES (v_run_id, v_t0, 'running', _retry_of, CASE WHEN _retry_of IS NULL THEN 'cron' ELSE 'auto_retry' END);

  BEGIN
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE x.action IS NOT NULL AND x.action <> 'skipped'),
      COUNT(*) FILTER (WHERE x.err IS NOT NULL)
    INTO v_processed, v_healed, v_errors
    FROM public.admin_heal_step_job_coupling_v4() x;

    IF v_processed = 0 THEN
      v_status := 'skipped';
    ELSIF v_errors > 0 AND v_healed = 0 THEN
      v_status := 'failed_structural';
    ELSE
      v_status := CASE WHEN _retry_of IS NULL THEN 'succeeded' ELSE 'retried_succeeded' END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
    v_msg := SQLERRM;
    v_class := public.fn_classify_pg_error(v_sqlstate, v_msg);
    v_status := CASE v_class WHEN 'transient' THEN 'failed_transient' ELSE 'failed_structural' END;
  END;

  -- Forensik immer anhängen (best effort)
  BEGIN
    SELECT public.fn_coupling_heal_v4_forensics() INTO v_forensics;
  EXCEPTION WHEN OTHERS THEN
    v_forensics := jsonb_build_object('error', SQLERRM);
  END;

  UPDATE public.coupling_heal_v4_runs
     SET finished_at = clock_timestamp(),
         duration_ms = EXTRACT(MILLISECOND FROM (clock_timestamp() - v_t0))::int
                     + EXTRACT(SECOND FROM (clock_timestamp() - v_t0))::int * 1000,
         status = v_status,
         processed_count = v_processed,
         healed_count = v_healed,
         errors_count = v_errors,
         sqlstate = v_sqlstate,
         error_message = v_msg,
         forensics = v_forensics
   WHERE id = v_run_id;

  -- Alerting
  IF v_status NOT IN ('succeeded','skipped','retried_succeeded') THEN
    INSERT INTO public.ops_alert_events(alert_key, severity, summary, details, dedupe_hash)
    VALUES (
      'coupling_heal_v4_' || v_status,
      CASE v_status WHEN 'failed_structural' THEN 'critical'
                    WHEN 'crashed' THEN 'critical'
                    ELSE 'warning' END,
      'coupling_heal_v4 ended with status ' || v_status,
      jsonb_build_object(
        'run_id', v_run_id,
        'sqlstate', v_sqlstate,
        'error_message', v_msg,
        'errors_count', v_errors,
        'forensics', v_forensics
      ),
      md5('coupling_heal_v4|' || v_status || '|' || COALESCE(v_sqlstate,'') || '|' || to_char(now(),'YYYY-MM-DD-HH24'))
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- Auto-Retry NUR bei transient & noch kein Retry
  IF v_status = 'failed_transient' AND _retry_of IS NULL THEN
    PERFORM pg_sleep(2);
    v_retry_id := public.fn_run_coupling_heal_v4_supervised(v_run_id);
  END IF;

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_run_coupling_heal_v4_supervised(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_coupling_heal_v4_supervised(uuid) TO service_role;

-- 5) Cron umstellen
DO $$
DECLARE v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'coupling_heal_15min_v4';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'coupling_heal_15min_v4',
  '*/15 * * * *',
  $cron$ SELECT public.fn_run_coupling_heal_v4_supervised(NULL); $cron$
);

-- 6) Lese-RPC fürs Dashboard
CREATE OR REPLACE FUNCTION public.admin_get_coupling_heal_v4_runs(_limit int DEFAULT 50)
RETURNS SETOF public.coupling_heal_v4_runs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.coupling_heal_v4_runs
     ORDER BY started_at DESC
     LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_coupling_heal_v4_runs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_coupling_heal_v4_runs(int) TO authenticated, service_role;
