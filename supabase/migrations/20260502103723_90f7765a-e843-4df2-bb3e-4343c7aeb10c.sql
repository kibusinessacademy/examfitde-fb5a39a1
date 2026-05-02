-- Control-Lane DAG-Drift Watchdog v1 (corrected: auto_heal_log.metadata)

DROP FUNCTION IF EXISTS public.fn_cancel_orphan_jobs_on_step_done() CASCADE;

CREATE OR REPLACE VIEW public.v_control_lane_dag_drift AS
WITH cp AS (
  SELECT jq.id AS job_id, jq.job_type,
         (jq.payload->>'package_id')::uuid AS pkg_id,
         replace(jq.job_type,'package_','') AS step_key,
         jq.created_at
  FROM public.job_queue jq
  WHERE jq.lane='control' AND jq.status='pending'
)
SELECT cp.job_type AS blocked_job_type,
       cp.pkg_id   AS package_id,
       dag.depends_on AS blocker_step,
       COALESCE(ps.status::text,'MISSING') AS blocker_status,
       cp.created_at AS job_created_at
FROM cp
JOIN public.step_dag_edges dag ON dag.step_key = cp.step_key
LEFT JOIN public.package_steps ps
  ON ps.package_id=cp.pkg_id AND ps.step_key=dag.depends_on
WHERE ps.status IS NULL OR ps.status::text NOT IN ('done','skipped');

REVOKE ALL ON public.v_control_lane_dag_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_control_lane_dag_drift TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_control_lane_drift()
RETURNS TABLE(
  blocked_job_type text,
  blocker_step text,
  blocker_status text,
  n_packages bigint,
  oldest_job_age_sec bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT v.blocked_job_type, v.blocker_step, v.blocker_status,
         COUNT(DISTINCT v.package_id)::bigint AS n_packages,
         EXTRACT(EPOCH FROM (now() - MIN(v.job_created_at)))::bigint AS oldest_job_age_sec
  FROM public.v_control_lane_dag_drift v
  GROUP BY v.blocked_job_type, v.blocker_step, v.blocker_status
  ORDER BY n_packages DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_control_lane_drift() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_control_lane_drift() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_heal_control_lane_dag_drift()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_lane_processing int;
  v_failed_qc       int := 0;
  v_pending_enq     int := 0;
  v_queued_qc       int := 0;
  v_nudged_pkgs     int := 0;
  v_pkg uuid;
  v_run_id uuid := gen_random_uuid();
BEGIN
  SELECT COUNT(*) INTO v_lane_processing
  FROM public.job_queue
  WHERE lane='control' AND status='processing';

  IF v_lane_processing > 0 THEN
    INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
    VALUES('control_lane_drift_skipped','skipped','system',
           jsonb_build_object('reason','lane_actively_processing','processing_jobs',v_lane_processing,'run_id',v_run_id));
    RETURN jsonb_build_object('skipped',true,'reason','lane_actively_processing','processing',v_lane_processing);
  END IF;

  BEGIN
    SELECT COALESCE((public.admin_heal_failed_quality_councils()->>'healed')::int, 0) INTO v_failed_qc;
  EXCEPTION WHEN OTHERS THEN v_failed_qc := -1;
  END;

  BEGIN
    SELECT COALESCE((public.admin_heal_pending_enqueue_drift()->>'healed')::int, 0) INTO v_pending_enq;
  EXCEPTION WHEN OTHERS THEN v_pending_enq := -1;
  END;

  FOR v_pkg IN
    SELECT DISTINCT ps.package_id
    FROM public.package_steps ps
    WHERE ps.step_key='quality_council' AND ps.status='queued'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type='package_quality_council'
          AND (jq.payload->>'package_id')::uuid = ps.package_id
          AND jq.status IN ('pending','processing')
      )
    LIMIT 50
  LOOP
    BEGIN
      PERFORM public.admin_nudge_atomic_trigger(v_pkg);
      v_nudged_pkgs := v_nudged_pkgs + 1;
      v_queued_qc   := v_queued_qc + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log(action_type,result_status,target_type,target_id,metadata)
      VALUES('control_lane_drift_nudge_failed','failed','course_packages',v_pkg,
             jsonb_build_object('error',SQLERRM,'run_id',v_run_id));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
  VALUES('control_lane_drift_heal','success','system',
         jsonb_build_object(
           'failed_qc_healed',v_failed_qc,
           'pending_enqueue_healed',v_pending_enq,
           'queued_qc_nudged',v_queued_qc,
           'pkgs_nudged',v_nudged_pkgs,
           'run_id',v_run_id
         ));

  RETURN jsonb_build_object(
    'skipped',false,
    'failed_qc_healed',v_failed_qc,
    'pending_enqueue_healed',v_pending_enq,
    'queued_qc_nudged',v_queued_qc,
    'run_id',v_run_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_heal_control_lane_dag_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_heal_control_lane_dag_drift() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_heal_control_lane_drift()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN public.fn_heal_control_lane_dag_drift();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_heal_control_lane_drift() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_control_lane_drift() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='control-lane-drift-heal-10min') THEN
      PERFORM cron.unschedule('control-lane-drift-heal-10min');
    END IF;
    PERFORM cron.schedule(
      'control-lane-drift-heal-10min',
      '*/10 * * * *',
      $cron$ SELECT public.fn_heal_control_lane_dag_drift(); $cron$
    );
  END IF;
END $$;

SELECT public.fn_heal_control_lane_dag_drift() AS initial_heal;