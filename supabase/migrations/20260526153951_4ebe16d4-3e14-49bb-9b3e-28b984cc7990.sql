
CREATE OR REPLACE VIEW public.v_queued_tail_without_job_v2 AS
SELECT
  cp.id AS package_id,
  cp.package_key,
  cp.curriculum_id,
  cp.track,
  cp.status AS package_status,
  (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id = cp.id AND eq.status = 'approved') AS approved_q,
  fn_is_bronze_locked(cp.id) AS bronze_locked,
  COALESCE(((cp.feature_flags->'bronze')->>'manual_bypass')::boolean, false) AS bronze_manual_bypass,
  (SELECT s.step_key
     FROM (
       SELECT ps.step_key,
              CASE ps.step_key
                WHEN 'run_integrity_check' THEN 1
                WHEN 'quality_council' THEN 2
                WHEN 'auto_publish' THEN 3
              END AS ord
       FROM package_steps ps
       WHERE ps.package_id = cp.id
         AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
         AND ps.status::text IN ('queued','blocked')
     ) s
     ORDER BY s.ord
     LIMIT 1
  ) AS next_tail_step
FROM course_packages cp
WHERE cp.status IN ('building','done')
  AND COALESCE(cp.archived, false) = false
  AND (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id = cp.id AND eq.status = 'approved') >= 50
  AND fn_is_bronze_locked(cp.id) = false
  AND NOT EXISTS (
    SELECT 1 FROM job_queue j
    WHERE j.package_id = cp.id
      AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending')
  )
  AND EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = cp.id
      AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
      AND ps.status::text IN ('queued','blocked')
  );

REVOKE ALL ON public.v_queued_tail_without_job_v2 FROM PUBLIC;
GRANT SELECT ON public.v_queued_tail_without_job_v2 TO service_role;

INSERT INTO ops_audit_contract(action_type, required_keys)
VALUES
  ('queued_tail_reconciler_v2', ARRAY['package_id','step_key','package_status']),
  ('queued_tail_reconciler_v2_error', ARRAY['package_id','step_key']),
  ('queued_tail_reconciler_v2_override', ARRAY['package_id','step_key','reason']),
  ('queued_tail_reconciler_v2_run_summary', ARRAY['dry_run','candidates','enqueued','skipped'])
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_reconcile_queued_tail_without_job_v2(
  p_dry_run boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_override_package_ids uuid[] DEFAULT NULL,
  p_override_reason text DEFAULT NULL
)
RETURNS TABLE(package_id uuid, package_key text, package_status text, next_tail_step text, action_taken text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
  rec RECORD;
  v_candidates INT := 0;
  v_enq INT := 0;
  v_skipped INT := 0;
  v_is_override BOOLEAN;
BEGIN
  IF v_caller IS NULL THEN
    v_is_admin := true;
  ELSE
    SELECT has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
    IF NOT v_is_admin THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;
  END IF;

  IF p_override_package_ids IS NOT NULL AND array_length(p_override_package_ids,1) > 0
     AND (p_override_reason IS NULL OR length(p_override_reason) < 5) THEN
    RAISE EXCEPTION 'p_override_reason must be >=5 chars when overriding';
  END IF;

  FOR rec IN
    SELECT v.*
    FROM v_queued_tail_without_job_v2 v
    WHERE v.next_tail_step IS NOT NULL
    ORDER BY v.approved_q DESC
    LIMIT p_limit
  LOOP
    v_candidates := v_candidates + 1;
    v_is_override := (p_override_package_ids IS NOT NULL AND rec.package_id = ANY(p_override_package_ids));

    IF p_dry_run THEN
      package_id := rec.package_id; package_key := rec.package_key;
      package_status := rec.package_status; next_tail_step := rec.next_tail_step;
      action_taken := 'DRY_RUN_WOULD_ENQUEUE[status=' || rec.package_status
                      || '/approved=' || rec.approved_q
                      || '/override=' || v_is_override::text || ']';
      RETURN NEXT; CONTINUE;
    END IF;

    IF public.fn_tail_heal_package_cooldown_active(rec.package_id, interval '5 minutes') THEN
      v_skipped := v_skipped + 1;
      PERFORM fn_emit_audit('queued_tail_reconciler_v2', jsonb_build_object(
        'package_id', rec.package_id, 'step_key', rec.next_tail_step,
        'package_status', rec.package_status, 'result','skipped_cooldown_5min'
      ));
      package_id := rec.package_id; package_key := rec.package_key;
      package_status := rec.package_status; next_tail_step := rec.next_tail_step;
      action_taken := 'SKIPPED:cooldown_5min';
      RETURN NEXT; CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name)
      VALUES (
        'package_' || rec.next_tail_step, 'pending', rec.package_id,
        jsonb_build_object(
          'package_id', rec.package_id,
          'curriculum_id', rec.curriculum_id,
          'enqueue_source', 'queued_tail_reconciler_v2',
          'step_key', rec.next_tail_step,
          'package_status', rec.package_status,
          'bronze_lock_override', v_is_override,
          'override_reason', CASE WHEN v_is_override THEN p_override_reason ELSE NULL END
        ),
        5, 'core', 'package_' || rec.next_tail_step
      );
      v_enq := v_enq + 1;

      PERFORM fn_emit_audit('queued_tail_reconciler_v2', jsonb_build_object(
        'package_id', rec.package_id, 'step_key', rec.next_tail_step,
        'package_status', rec.package_status, 'package_key', rec.package_key,
        'approved_q', rec.approved_q, 'result','enqueued',
        'override', v_is_override
      ));

      IF v_is_override THEN
        PERFORM fn_emit_audit('queued_tail_reconciler_v2_override', jsonb_build_object(
          'package_id', rec.package_id, 'step_key', rec.next_tail_step,
          'reason', p_override_reason
        ));
      END IF;

      package_id := rec.package_id; package_key := rec.package_key;
      package_status := rec.package_status; next_tail_step := rec.next_tail_step;
      action_taken := 'ENQUEUED[status=' || rec.package_status || ']';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      PERFORM fn_emit_audit('queued_tail_reconciler_v2_error', jsonb_build_object(
        'package_id', rec.package_id, 'step_key', rec.next_tail_step,
        'sqlerrm', SQLERRM
      ));
      package_id := rec.package_id; package_key := rec.package_key;
      package_status := rec.package_status; next_tail_step := rec.next_tail_step;
      action_taken := 'ERROR:' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  PERFORM fn_emit_audit('queued_tail_reconciler_v2_run_summary', jsonb_build_object(
    'dry_run', p_dry_run, 'candidates', v_candidates,
    'enqueued', v_enq, 'skipped', v_skipped,
    'override_count', COALESCE(array_length(p_override_package_ids,1),0)
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_queued_tail_without_job_v2(boolean,int,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_queued_tail_without_job_v2(boolean,int,uuid[],text) TO service_role;
