
CREATE OR REPLACE FUNCTION public.fn_recover_failed_predecessor_steps(
  _max_recoveries int DEFAULT 50
)
RETURNS TABLE(out_package_id uuid, out_step_key text, out_blocked_jobs int, out_recovery_attempt int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_attempt int;
BEGIN
  FOR r IN
    WITH waiting_jobs AS (
      SELECT DISTINCT jq.package_id AS pkg_id, replace(jq.job_type,'package_','') AS sk
      FROM job_queue jq
      WHERE jq.status='pending'
        AND jq.job_type LIKE 'package_%'
        AND jq.package_id IS NOT NULL
        AND (jq.run_after IS NULL OR jq.run_after <= now())
    ),
    needed_predecessors AS (
      SELECT DISTINCT wj.pkg_id, dag.depends_on AS pred_step
      FROM waiting_jobs wj
      JOIN step_dag_edges dag ON dag.step_key = wj.sk
    ),
    failed_preds AS (
      SELECT ps.package_id AS pkg_id, ps.step_key AS sk,
             COALESCE((ps.meta->>'auto_recovery_count')::int, 0) AS recov_count,
             (ps.meta->>'last_auto_recovery_at')::timestamptz AS last_recov,
             (SELECT count(*) FROM waiting_jobs wj 
              WHERE wj.pkg_id=ps.package_id 
              AND wj.sk IN (
                SELECT step_key FROM step_dag_edges WHERE depends_on=ps.step_key
              )
             ) AS blocked
      FROM package_steps ps
      JOIN needed_predecessors np 
        ON np.pkg_id = ps.package_id 
        AND np.pred_step = ps.step_key
      WHERE ps.status = 'failed'
    )
    SELECT *
    FROM failed_preds fp
    WHERE fp.recov_count < 3
      AND (fp.last_recov IS NULL OR fp.last_recov < now() - interval '20 minutes')
      AND fp.blocked > 0
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = fp.pkg_id
          AND jq.job_type = 'package_' || fp.sk
          AND jq.status IN ('pending','processing','running')
      )
    LIMIT _max_recoveries
  LOOP
    v_attempt := r.recov_count + 1;

    UPDATE package_steps
    SET status = 'queued'::step_status,
        meta = COALESCE(meta,'{}'::jsonb) 
               || jsonb_build_object(
                    'auto_recovery_count', v_attempt,
                    'last_auto_recovery_at', now(),
                    'recovery_reason', 'blocking_downstream_jobs'
                  ),
        updated_at = now()
    WHERE package_steps.package_id = r.pkg_id
      AND package_steps.step_key = r.sk;

    out_package_id := r.pkg_id;
    out_step_key := r.sk;
    out_blocked_jobs := r.blocked;
    out_recovery_attempt := v_attempt;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_recover_failed_predecessor_steps(int) TO authenticated, service_role;

-- Sofort-Run
SELECT * FROM public.fn_recover_failed_predecessor_steps(100);

-- Cron alle 7 Min
DO $$
BEGIN
  PERFORM cron.unschedule('recover-failed-predecessor-steps');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'recover-failed-predecessor-steps',
  '*/7 * * * *',
  $$ SELECT public.fn_recover_failed_predecessor_steps(50); $$
);
