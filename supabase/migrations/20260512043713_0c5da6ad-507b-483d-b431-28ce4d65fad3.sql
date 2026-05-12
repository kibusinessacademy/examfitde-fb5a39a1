-- Audit-Tabelle für Worker-Restart-Runs
CREATE TABLE IF NOT EXISTS public.pipeline_worker_restart_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  caller_id uuid,
  window_minutes int NOT NULL,
  max_requeue int NOT NULL,
  requeued_count int NOT NULL DEFAULT 0,
  requeued_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  error_classes_touched jsonb NOT NULL DEFAULT '[]'::jsonb,
  reaper_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  delta_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pwra_created_at ON public.pipeline_worker_restart_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pwra_run_id ON public.pipeline_worker_restart_audit(run_id);

ALTER TABLE public.pipeline_worker_restart_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read worker restart audit" ON public.pipeline_worker_restart_audit;
CREATE POLICY "admin read worker restart audit"
ON public.pipeline_worker_restart_audit
FOR SELECT
USING (public.fn_is_admin_or_service_role(auth.uid()));

REVOKE ALL ON public.pipeline_worker_restart_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pipeline_worker_restart_audit TO service_role;

-- Restart-RPC mit Pre/Post-Snapshot + Audit-Insert
CREATE OR REPLACE FUNCTION public.admin_pipeline_worker_restart(
  p_window_minutes integer DEFAULT 60,
  p_max_requeue integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_run_id uuid := gen_random_uuid();
  v_reaped jsonb := '{}'::jsonb;
  v_requeued int := 0;
  v_requeued_ids uuid[] := ARRAY[]::uuid[];
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_classes jsonb := '[]'::jsonb;
  v_delta jsonb := '{}'::jsonb;
  v_before_total int := 0;
  v_after_total int := 0;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  -- BEFORE-Snapshot
  SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
    INTO v_before
  FROM public.admin_get_pipeline_failure_drilldown(p_window_minutes, 50) d;

  v_before_total := COALESCE((SELECT SUM((x->>'failure_count')::int) FROM jsonb_array_elements(v_before) x), 0);

  -- Reaper
  BEGIN
    v_reaped := COALESCE(public.fn_reap_stale_processing_jobs(), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_reaped := jsonb_build_object('error', SQLERRM);
  END;

  -- Transient Failures requeuen + Fehlerklassen sammeln
  WITH cand AS (
    SELECT j.id, COALESCE(NULLIF(j.last_error_code,''),'NO_CODE') AS ec
    FROM public.job_queue j
    WHERE j.status = 'failed'
      AND j.updated_at > now() - make_interval(mins => p_window_minutes)
      AND (
        COALESCE(j.last_error_code,'') ILIKE '%TIMEOUT%'
        OR COALESCE(j.last_error_code,'') ILIKE '%CPU%'
        OR COALESCE(j.last_error_code,'') = 'WORKER_KILLED'
        OR COALESCE(j.last_error_code,'') ILIKE '%RATE_LIMIT%'
        OR COALESCE(j.last_error_code,'') ILIKE '%429%'
      )
    ORDER BY j.updated_at DESC
    LIMIT p_max_requeue
  ),
  classes_agg AS (
    SELECT jsonb_agg(jsonb_build_object('error_code', ec, 'count', cnt)) AS j
    FROM (SELECT ec, COUNT(*)::int AS cnt FROM cand GROUP BY ec ORDER BY cnt DESC) z
  ),
  upd AS (
    UPDATE public.job_queue j
       SET status = 'queued',
           updated_at = now(),
           run_after = now(),
           last_error = NULL,
           last_error_code = NULL,
           attempts = COALESCE(attempts, 0)
     FROM cand
     WHERE j.id = cand.id
     RETURNING j.id
  )
  SELECT COUNT(*)::int, COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE((SELECT j FROM classes_agg), '[]'::jsonb)
    INTO v_requeued, v_requeued_ids, v_classes
  FROM upd;

  -- AFTER-Snapshot
  SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
    INTO v_after
  FROM public.admin_get_pipeline_failure_drilldown(p_window_minutes, 50) d;

  v_after_total := COALESCE((SELECT SUM((x->>'failure_count')::int) FROM jsonb_array_elements(v_after) x), 0);

  v_delta := jsonb_build_object(
    'before_failure_total', v_before_total,
    'after_failure_total', v_after_total,
    'delta', v_after_total - v_before_total,
    'distinct_error_classes_touched', jsonb_array_length(v_classes)
  );

  -- Audit-Insert
  INSERT INTO public.pipeline_worker_restart_audit(
    run_id, caller_id, window_minutes, max_requeue,
    requeued_count, requeued_ids, error_classes_touched,
    reaper_summary, before_snapshot, after_snapshot, delta_summary
  ) VALUES (
    v_run_id, v_caller, p_window_minutes, p_max_requeue,
    v_requeued, v_requeued_ids, v_classes,
    v_reaped, v_before, v_after, v_delta
  );

  -- auto_heal_log Spiegel
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'admin_pipeline_worker_restart',
    'system',
    CASE WHEN v_requeued > 0 OR (v_reaped ? 'reaped') THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'run_id', v_run_id,
      'caller_id', v_caller,
      'window_minutes', p_window_minutes,
      'requeued', v_requeued,
      'requeued_ids', to_jsonb(v_requeued_ids),
      'error_classes_touched', v_classes,
      'reaper', v_reaped,
      'delta', v_delta
    )
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'requeued', v_requeued,
    'requeued_ids', to_jsonb(v_requeued_ids),
    'error_classes_touched', v_classes,
    'reaper', v_reaped,
    'delta', v_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pipeline_worker_restart(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pipeline_worker_restart(integer, integer) TO authenticated, service_role;

-- Reader-RPC für UI
CREATE OR REPLACE FUNCTION public.admin_get_pipeline_worker_restart_audit(p_limit integer DEFAULT 25)
RETURNS TABLE(
  id uuid,
  run_id uuid,
  caller_id uuid,
  window_minutes int,
  requeued_count int,
  requeued_ids uuid[],
  error_classes_touched jsonb,
  reaper_summary jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  delta_summary jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;
  RETURN QUERY
  SELECT a.id, a.run_id, a.caller_id, a.window_minutes,
         a.requeued_count, a.requeued_ids, a.error_classes_touched,
         a.reaper_summary, a.before_snapshot, a.after_snapshot, a.delta_summary,
         a.created_at
  FROM public.pipeline_worker_restart_audit a
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(200, p_limit));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_pipeline_worker_restart_audit(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pipeline_worker_restart_audit(integer) TO authenticated, service_role;