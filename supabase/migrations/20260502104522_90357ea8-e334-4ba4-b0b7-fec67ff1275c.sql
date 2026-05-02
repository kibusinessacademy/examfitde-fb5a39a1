-- ============================================================================
-- Control-Lane DAG-Drift Watchdog v1.1
-- Fixes: 
--   1) target_id muss text-gecastet werden (Spalte ist text, nicht uuid)
--   2) Skip nur bei "frischer" Aktivität (updated_at < 10min), nicht bei stale processing
--   3) Cron-Schedule sicherstellen: '*/10 * * * *'
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_heal_control_lane_dag_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lane_active_processing int;
  v_lane_stale_processing  int;
  v_failed_qc       int := 0;
  v_pending_enq     int := 0;
  v_queued_qc       int := 0;
  v_nudged_pkgs     int := 0;
  v_pkg uuid;
  v_run_id uuid := gen_random_uuid();
BEGIN
  -- FIX: Skip nur bei wirklich frischer Aktivität (updated_at innerhalb 10min).
  -- Ein einzelner stale processing-Job darf den Heal NICHT dauerhaft blockieren.
  SELECT 
    COUNT(*) FILTER (WHERE updated_at > now() - interval '10 minutes'),
    COUNT(*) FILTER (WHERE updated_at <= now() - interval '10 minutes')
  INTO v_lane_active_processing, v_lane_stale_processing
  FROM public.job_queue
  WHERE lane='control' AND status='processing';

  IF v_lane_active_processing > 0 THEN
    INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
    VALUES('control_lane_drift_skipped','skipped','system',
           jsonb_build_object(
             'reason','lane_actively_processing',
             'active_processing_jobs',v_lane_active_processing,
             'stale_processing_jobs',v_lane_stale_processing,
             'run_id',v_run_id
           ));
    RETURN jsonb_build_object(
      'skipped',true,
      'reason','lane_actively_processing',
      'active_processing',v_lane_active_processing,
      'stale_processing',v_lane_stale_processing
    );
  END IF;

  -- Stale processing-Jobs werden geloggt, aber blockieren NICHT.
  IF v_lane_stale_processing > 0 THEN
    INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
    VALUES('control_lane_drift_stale_processing_detected','warning','system',
           jsonb_build_object(
             'stale_processing_jobs',v_lane_stale_processing,
             'note','heal_proceeds_despite_stale_jobs',
             'run_id',v_run_id
           ));
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
      -- FIX: target_id ist text → v_pkg::text
      INSERT INTO public.auto_heal_log(action_type,result_status,target_type,target_id,metadata)
      VALUES('control_lane_drift_nudge_failed','failed','course_packages', v_pkg::text,
             jsonb_build_object(
               'package_id', v_pkg,
               'error', SQLERRM,
               'run_id', v_run_id
             ));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
  VALUES('control_lane_drift_heal','success','system',
         jsonb_build_object(
           'failed_qc_healed',v_failed_qc,
           'pending_enqueue_healed',v_pending_enq,
           'queued_qc_nudged',v_queued_qc,
           'pkgs_nudged',v_nudged_pkgs,
           'stale_processing_seen',v_lane_stale_processing,
           'run_id',v_run_id
         ));

  RETURN jsonb_build_object(
    'skipped',false,
    'failed_qc_healed',v_failed_qc,
    'pending_enqueue_healed',v_pending_enq,
    'queued_qc_nudged',v_queued_qc,
    'pkgs_nudged',v_nudged_pkgs,
    'stale_processing_seen',v_lane_stale_processing,
    'run_id',v_run_id
  );
END;
$function$;

-- Cron-Schedule sicherstellen (idempotent: unschedule+reschedule)
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'control-lane-drift-heal-10min';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'control-lane-drift-heal-10min',
    '*/10 * * * *',
    $cron$ SELECT public.fn_heal_control_lane_dag_drift(); $cron$
  );
END $$;