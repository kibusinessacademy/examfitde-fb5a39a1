CREATE OR REPLACE FUNCTION public.admin_reconcile_queued_tail_without_job(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 50)
 RETURNS TABLE(package_id uuid, package_key text, next_tail_step text, action_taken text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
  rec RECORD;
  v_enq_count INT := 0;
  v_skipped_count INT := 0;
  v_cooldown_count INT := 0;
  v_gate_skipped INT := 0;
BEGIN
  IF v_caller IS NULL THEN
    v_is_admin := true;
  ELSE
    SELECT has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: admin role required';
    END IF;
  END IF;

  FOR rec IN
    SELECT v.package_id, v.package_key, v.curriculum_id, v.next_tail_step, v.bronze_bypass,
           prg.gate_class, prg.score
    FROM v_queued_tail_without_job v
    JOIN v_publish_readiness_gate prg ON prg.package_id = v.package_id
    WHERE v.reconciler_verdict='ELIGIBLE'
      AND v.next_tail_step IS NOT NULL
      AND prg.gate_class IN ('READY','STALE_INTEGRITY','COUNCIL_PENDING','AUTO_PUBLISH_PENDING')
      AND (
        (v.next_tail_step = 'run_integrity_check' AND prg.gate_class = 'STALE_INTEGRITY')
        OR (v.next_tail_step = 'quality_council'    AND prg.gate_class IN ('READY','COUNCIL_PENDING'))
        OR (v.next_tail_step = 'auto_publish'       AND prg.gate_class IN ('READY','AUTO_PUBLISH_PENDING'))
      )
    ORDER BY v.approved_q DESC
    LIMIT p_limit
  LOOP
    IF NOT p_dry_run AND public.fn_tail_heal_package_cooldown_active(rec.package_id, interval '5 minutes') THEN
      v_cooldown_count := v_cooldown_count + 1;
      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.package_id::text, 'package', 'tail_heal_skipped_package_cooldown', 'skipped',
              jsonb_build_object('package_id', rec.package_id,
                                 'producer','queued_tail_reconciler_enqueue',
                                 'step_key', rec.next_tail_step, 'window','5 minutes',
                                 'gate_class', rec.gate_class));
      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step; action_taken := 'SKIPPED:cooldown_5min';
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'DRY_RUN_WOULD_ENQUEUE[' || rec.gate_class || '/score=' || COALESCE(rec.score::text,'-') || ']';
      RETURN NEXT; CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name)
      VALUES (
        'package_' || rec.next_tail_step, 'pending', rec.package_id,
        jsonb_build_object(
          'package_id', rec.package_id,
          'curriculum_id', rec.curriculum_id,
          'enqueue_source', 'queued_tail_reconciler_v2_gate_aware',
          'step_key', rec.next_tail_step,
          'bronze_lock_override', rec.bronze_bypass,
          'gate_class', rec.gate_class
        ),
        5, 'core', 'package_' || rec.next_tail_step
      );

      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.package_id::text, 'package', 'queued_tail_reconciler_enqueue', 'success',
              jsonb_build_object('package_id', rec.package_id,
                                 'step_key', rec.next_tail_step, 'package_key', rec.package_key,
                                 'bronze_bypass', rec.bronze_bypass, 'gate_class', rec.gate_class,
                                 'rpc_version','v2_gate_aware'));
      v_enq_count := v_enq_count + 1;

      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step; action_taken := 'ENQUEUED[' || rec.gate_class || ']';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, error_message, metadata)
      VALUES (rec.package_id::text, 'package', 'queued_tail_reconciler_enqueue_error', 'failed', SQLERRM,
              jsonb_build_object('package_id', rec.package_id, 'step_key', rec.next_tail_step,
                                 'gate_class', rec.gate_class));
      v_skipped_count := v_skipped_count + 1;
      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step; action_taken := 'SKIPPED:' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
  VALUES (NULL, 'system', 'queued_tail_reconciler_run_summary', 'success',
          jsonb_build_object('dry_run', p_dry_run, 'enqueued', v_enq_count,
                             'errored', v_skipped_count, 'cooldown_skipped', v_cooldown_count,
                             'rpc_version','v2_gate_aware'));
END;
$function$;