
CREATE OR REPLACE VIEW public.v_dag_blocked_jobs AS
WITH active_jobs AS (
  SELECT j.id AS job_id, j.job_type, j.package_id, j.status, j.last_error,
         j.attempts, j.created_at, j.updated_at, j.run_after,
         regexp_replace(j.job_type, '^package_', '') AS step_key
  FROM job_queue j
  WHERE j.status IN ('pending','queued','blocked')
    AND j.job_type LIKE 'package_%'
    AND j.package_id IS NOT NULL
),
job_parents AS (
  SELECT aj.*, e.depends_on AS parent_step_key
  FROM active_jobs aj
  LEFT JOIN step_dag_edges e ON e.step_key = aj.step_key
),
parent_status AS (
  SELECT jp.job_id, jp.job_type, jp.package_id, jp.status AS job_status,
         jp.last_error, jp.attempts, jp.created_at, jp.updated_at,
         jp.step_key, jp.parent_step_key,
         ps.status::text AS parent_step_status,
         ps.last_error AS parent_last_error,
         ps.updated_at AS parent_updated_at,
         (SELECT COUNT(*) FROM job_queue jq
            WHERE jq.package_id = jp.package_id
              AND jq.job_type = 'package_' || jp.parent_step_key
              AND jq.status IN ('pending','queued','processing')) AS parent_active_jobs
  FROM job_parents jp
  LEFT JOIN package_steps ps ON ps.package_id = jp.package_id AND ps.step_key = jp.parent_step_key
)
SELECT ps.*,
       cp.title AS package_title,
       cp.status AS package_status,
       (cp.feature_flags->'bronze'->>'locked')::boolean AS bronze_locked,
       CASE
         WHEN ps.parent_step_key IS NULL THEN 'no_parent_required'
         WHEN ps.parent_step_status IN ('done','skipped') THEN 'parent_done_drift'
         WHEN ps.parent_step_status = 'failed' THEN 'parent_failed'
         WHEN ps.parent_active_jobs > 0 THEN 'parent_active'
         WHEN ps.parent_step_status IN ('queued','pending_enqueue','enqueued') THEN 'parent_queued_no_job'
         WHEN ps.parent_step_status IS NULL THEN 'parent_step_missing'
         ELSE 'parent_other'
       END AS block_reason,
       EXTRACT(EPOCH FROM (now() - ps.created_at))/60 AS minutes_blocked
FROM parent_status ps
JOIN course_packages cp ON cp.id = ps.package_id;

REVOKE ALL ON public.v_dag_blocked_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_dag_blocked_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_dag_blocked_overview()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_summary jsonb; v_by_pkg jsonb; v_jobs jsonb;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_blocked', (SELECT COUNT(*) FROM v_dag_blocked_jobs),
    'by_reason', COALESCE((SELECT jsonb_object_agg(block_reason, c)
                             FROM (SELECT block_reason, COUNT(*) c FROM v_dag_blocked_jobs GROUP BY 1) x), '{}'::jsonb),
    'oldest_minutes', COALESCE((SELECT MAX(minutes_blocked)::int FROM v_dag_blocked_jobs), 0),
    'severity', CASE
      WHEN (SELECT COUNT(*) FROM v_dag_blocked_jobs) >= 50 THEN 'P0'
      WHEN (SELECT COUNT(*) FROM v_dag_blocked_jobs) >= 20 THEN 'P1'
      WHEN (SELECT COUNT(*) FROM v_dag_blocked_jobs) >= 5 THEN 'P2'
      ELSE 'OK' END
  ) INTO v_summary;

  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb) INTO v_by_pkg FROM (
    SELECT package_id, package_title, package_status, bronze_locked,
           COUNT(*) AS blocked_count,
           MAX(minutes_blocked)::int AS oldest_minutes,
           array_agg(DISTINCT block_reason) AS reasons,
           array_agg(DISTINCT step_key) AS blocked_steps,
           array_agg(DISTINCT parent_step_key) FILTER (WHERE parent_step_key IS NOT NULL) AS parent_steps
    FROM v_dag_blocked_jobs
    GROUP BY 1,2,3,4
    ORDER BY COUNT(*) DESC, MAX(minutes_blocked) DESC
    LIMIT 100
  ) p;

  SELECT COALESCE(jsonb_agg(j), '[]'::jsonb) INTO v_jobs FROM (
    SELECT job_id, package_id, package_title, step_key, parent_step_key,
           parent_step_status, parent_active_jobs, block_reason,
           minutes_blocked::int, last_error, attempts, bronze_locked
    FROM v_dag_blocked_jobs
    ORDER BY minutes_blocked DESC
    LIMIT 200
  ) j;

  RETURN jsonb_build_object('summary', v_summary, 'by_package', v_by_pkg, 'jobs', v_jobs, 'fetched_at', now());
END $$;

REVOKE ALL ON FUNCTION public.admin_get_dag_blocked_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dag_blocked_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_heal_dag_blocked_jobs(
  p_package_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT false,
  p_max_packages int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run_id uuid := gen_random_uuid();
  v_actions jsonb := '[]'::jsonb;
  v_re_enqueued int := 0; v_steps_requeued int := 0; v_skipped int := 0;
  r record;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.transition_source', 'admin_dag_heal:'||v_uid::text, true);

  FOR r IN
    SELECT DISTINCT ON (package_id, parent_step_key)
           package_id, package_title, step_key, parent_step_key,
           parent_step_status, parent_active_jobs, block_reason, bronze_locked
    FROM v_dag_blocked_jobs
    WHERE parent_step_key IS NOT NULL
      AND block_reason IN ('parent_failed','parent_queued_no_job','parent_step_missing','parent_done_drift')
      AND (p_package_id IS NULL OR package_id = p_package_id)
    ORDER BY package_id, parent_step_key
    LIMIT p_max_packages * 5
  LOOP
    IF p_dry_run THEN
      v_actions := v_actions || jsonb_build_object(
        'package_id', r.package_id, 'parent_step', r.parent_step_key,
        'reason', r.block_reason, 'action', 'would_heal');
      CONTINUE;
    END IF;

    IF r.parent_step_status = 'failed' THEN
      UPDATE package_steps
         SET status = 'queued', last_error = NULL,
             meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
               'dag_heal_reset_at', now(), 'dag_heal_run_id', v_run_id)
       WHERE package_id = r.package_id AND step_key = r.parent_step_key;
      v_steps_requeued := v_steps_requeued + 1;
    END IF;

    IF r.parent_active_jobs = 0 THEN
      INSERT INTO job_queue (job_type, package_id, status, run_after, payload, meta)
      VALUES (
        'package_' || r.parent_step_key, r.package_id, 'pending', now(),
        jsonb_build_object('package_id', r.package_id,
                           'bronze_lock_override', true,
                           'enqueue_source', 'dag_blocked_auto_heal'),
        jsonb_build_object('enqueue_source', 'dag_blocked_auto_heal',
                           'dag_heal_run_id', v_run_id,
                           'block_reason', r.block_reason,
                           'bronze_locked', COALESCE(r.bronze_locked, false))
      );
      v_re_enqueued := v_re_enqueued + 1;
      v_actions := v_actions || jsonb_build_object(
        'package_id', r.package_id, 'parent_step', r.parent_step_key,
        'reason', r.block_reason, 'action', 'parent_re_enqueued');
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'dag_blocked_auto_heal',
    CASE WHEN p_package_id IS NULL THEN 'system' ELSE 'package' END,
    p_package_id,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('run_id', v_run_id,
                       'parents_re_enqueued', v_re_enqueued,
                       'steps_requeued', v_steps_requeued,
                       'skipped_parent_active', v_skipped,
                       'actions', v_actions));

  RETURN jsonb_build_object('run_id', v_run_id, 'dry_run', p_dry_run,
                            'parents_re_enqueued', v_re_enqueued,
                            'steps_requeued', v_steps_requeued,
                            'skipped_parent_active', v_skipped,
                            'actions', v_actions);
END $$;

REVOKE ALL ON FUNCTION public.admin_heal_dag_blocked_jobs(uuid, boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_dag_blocked_jobs(uuid, boolean, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_alert_dag_blocked_jobs(
  p_p1_threshold int DEFAULT 20,
  p_p0_threshold int DEFAULT 50,
  p_stale_minutes int DEFAULT 60,
  p_dedupe_minutes int DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_oldest int; v_severity text; v_recent int; v_top_pkgs jsonb;
BEGIN
  SELECT COUNT(*), COALESCE(MAX(minutes_blocked)::int, 0)
    INTO v_total, v_oldest FROM v_dag_blocked_jobs;

  IF v_total >= p_p0_threshold OR (v_total >= p_p1_threshold AND v_oldest >= p_stale_minutes * 2) THEN
    v_severity := 'P0';
  ELSIF v_total >= p_p1_threshold OR v_oldest >= p_stale_minutes THEN
    v_severity := 'P1';
  ELSE
    INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('dag_blocked_alert_check','system','noop',
      jsonb_build_object('total', v_total, 'oldest_minutes', v_oldest));
    RETURN jsonb_build_object('severity','OK','total',v_total);
  END IF;

  SELECT COUNT(*) INTO v_recent FROM auto_heal_log
   WHERE action_type = 'dag_blocked_alert'
     AND created_at > now() - (p_dedupe_minutes || ' minutes')::interval
     AND result_status = v_severity;
  IF v_recent > 0 THEN
    RETURN jsonb_build_object('severity', v_severity, 'deduped', true);
  END IF;

  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb) INTO v_top_pkgs FROM (
    SELECT package_id, package_title, COUNT(*) AS blocked, MAX(minutes_blocked)::int AS oldest_min,
           array_agg(DISTINCT parent_step_key) FILTER (WHERE parent_step_key IS NOT NULL) AS parents
    FROM v_dag_blocked_jobs
    GROUP BY 1,2 ORDER BY COUNT(*) DESC, MAX(minutes_blocked) DESC LIMIT 10
  ) p;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('dag_blocked_alert','system', v_severity,
    jsonb_build_object('severity', v_severity, 'total', v_total,
                       'oldest_minutes', v_oldest, 'top_packages', v_top_pkgs,
                       'link', '/admin/queue?tab=heal#dag-blocked'));

  RETURN jsonb_build_object('severity', v_severity, 'total', v_total, 'oldest_minutes', v_oldest);
END $$;

CREATE OR REPLACE FUNCTION public.admin_retry_dag_blocked_for_package(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN admin_heal_dag_blocked_jobs(p_package_id, false, 50);
END $$;

REVOKE ALL ON FUNCTION public.admin_retry_dag_blocked_for_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_dag_blocked_for_package(uuid) TO authenticated;

DO $$ BEGIN PERFORM cron.unschedule('dag-blocked-alert-and-heal-10min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'dag-blocked-alert-and-heal-10min',
  '*/10 * * * *',
  $cron$
  SELECT public.fn_alert_dag_blocked_jobs();
  SELECT public.admin_heal_dag_blocked_jobs(NULL, false, 30);
  $cron$
);
