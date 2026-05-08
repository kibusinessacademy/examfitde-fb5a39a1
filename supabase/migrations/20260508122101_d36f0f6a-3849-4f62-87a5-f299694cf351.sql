-- ============================================================================
-- Queued-Tail-Without-Job Reconciler v1
-- Heilt nur run_integrity_check / quality_council / auto_publish im Status 'queued'
-- wenn kein Job aktiv ist und kein Bronze-Review-Lock greift.
-- Bronze-Lock-Bypass nur bei feature_flags.bronze.manual_bypass=true.
-- Single-Step pro Paket pro Lauf (DAG-Reihenfolge: integrity > council > auto_publish).
-- ============================================================================

-- 1. Monitoring view
CREATE OR REPLACE VIEW v_queued_tail_without_job AS
SELECT
  cp.id AS package_id,
  cp.package_key,
  cp.curriculum_id,
  cp.track,
  (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') AS approved_q,
  COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) AS bronze_review,
  COALESCE((cp.feature_flags->'bronze'->>'manual_bypass')::boolean, false) AS bronze_bypass,
  -- Pick first queued tail step in DAG order
  (SELECT step_key FROM (
     SELECT step_key, CASE step_key
       WHEN 'run_integrity_check' THEN 1
       WHEN 'quality_council'    THEN 2
       WHEN 'auto_publish'       THEN 3 END AS ord
     FROM package_steps ps
     WHERE ps.package_id=cp.id
       AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
       AND ps.status::text='queued'
   ) s ORDER BY ord LIMIT 1
  ) AS next_tail_step,
  CASE
    WHEN COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean,false)=true
     AND COALESCE((cp.feature_flags->'bronze'->>'manual_bypass')::boolean,false)=false
       THEN 'BRONZE_REVIEW_TERMINAL'
    ELSE 'ELIGIBLE'
  END AS reconciler_verdict
FROM course_packages cp
WHERE cp.status='building'
  AND COALESCE(cp.archived,false)=false
  AND NOT EXISTS (
    SELECT 1 FROM job_queue j
    WHERE j.package_id=cp.id
      AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending')
  )
  AND EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id=cp.id
      AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
      AND ps.status::text='queued'
  );

REVOKE ALL ON v_queued_tail_without_job FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_queued_tail_without_job TO service_role;

-- 2. Reconciler RPC (SECURITY DEFINER + admin gate)
CREATE OR REPLACE FUNCTION public.admin_reconcile_queued_tail_without_job(
  p_dry_run BOOLEAN DEFAULT true,
  p_limit INT DEFAULT 50
) RETURNS TABLE (
  package_id UUID,
  package_key TEXT,
  next_tail_step TEXT,
  action_taken TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
  rec RECORD;
  v_enq_count INT := 0;
  v_skipped_count INT := 0;
BEGIN
  IF v_caller IS NULL THEN
    v_is_admin := true; -- service_role / direct DB
  ELSE
    SELECT has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: admin role required';
    END IF;
  END IF;

  FOR rec IN
    SELECT v.package_id, v.package_key, v.curriculum_id, v.next_tail_step, v.bronze_bypass
    FROM v_queued_tail_without_job v
    WHERE v.reconciler_verdict='ELIGIBLE'
      AND v.next_tail_step IS NOT NULL
    ORDER BY v.approved_q DESC
    LIMIT p_limit
  LOOP
    IF p_dry_run THEN
      package_id := rec.package_id;
      package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'DRY_RUN_WOULD_ENQUEUE';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name)
      VALUES (
        'package_' || rec.next_tail_step,
        'pending',
        rec.package_id,
        jsonb_build_object(
          'package_id', rec.package_id,
          'curriculum_id', rec.curriculum_id,
          'enqueue_source', 'queued_tail_reconciler_v1',
          'step_key', rec.next_tail_step,
          'bronze_lock_override', rec.bronze_bypass
        ),
        5, 'core', 'package_' || rec.next_tail_step
      );

      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.package_id, 'package', 'queued_tail_reconciler_enqueue', 'success',
              jsonb_build_object('step_key', rec.next_tail_step, 'package_key', rec.package_key,
                                 'bronze_bypass', rec.bronze_bypass));
      v_enq_count := v_enq_count + 1;

      package_id := rec.package_id;
      package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'ENQUEUED';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, error_message, metadata)
      VALUES (rec.package_id, 'package', 'queued_tail_reconciler_enqueue_error', 'failed', SQLERRM,
              jsonb_build_object('step_key', rec.next_tail_step));
      v_skipped_count := v_skipped_count + 1;

      package_id := rec.package_id;
      package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'SKIPPED:' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
  VALUES (NULL, 'system', 'queued_tail_reconciler_run_summary', 'success',
          jsonb_build_object('dry_run', p_dry_run, 'enqueued', v_enq_count, 'skipped', v_skipped_count));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reconcile_queued_tail_without_job(BOOLEAN, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_queued_tail_without_job(BOOLEAN, INT) TO service_role;

-- 3. Cron: every 10 minutes
SELECT cron.unschedule('queued-tail-reconciler-10min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='queued-tail-reconciler-10min'
);
SELECT cron.schedule(
  'queued-tail-reconciler-10min',
  '*/10 * * * *',
  $cron$ SELECT public.admin_reconcile_queued_tail_without_job(false, 30); $cron$
);

-- 4. Smoke test
DO $$
DECLARE
  v_eligible INT;
  v_terminal INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE reconciler_verdict='ELIGIBLE'),
         COUNT(*) FILTER (WHERE reconciler_verdict='BRONZE_REVIEW_TERMINAL')
    INTO v_eligible, v_terminal
  FROM v_queued_tail_without_job;
  RAISE NOTICE 'Reconciler smoke: eligible=%, bronze_review_terminal=%', v_eligible, v_terminal;
END $$;

-- Rollback hint:
--   DROP FUNCTION public.admin_reconcile_queued_tail_without_job(BOOLEAN, INT);
--   DROP VIEW v_queued_tail_without_job;
--   SELECT cron.unschedule('queued-tail-reconciler-10min');