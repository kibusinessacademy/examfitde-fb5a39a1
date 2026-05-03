CREATE OR REPLACE FUNCTION public.fn_heal_orphan_queued_steps(p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_healed int := 0;
  v_skipped int := 0;
  v_pending int := 0;
  v_job_type text;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
BEGIN
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.id AS step_id, cp.curriculum_id, cp.status::text AS pkg_status,
           COALESCE((ps.meta->>'last_enqueue_attempt')::timestamptz, 'epoch'::timestamptz) AS last_attempt
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'::step_status
      AND cp.status::text IN ('building','quality_gate_failed','blocked','planning','queued')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.payload->>'step_key' = ps.step_key
          AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled')
      )
    ORDER BY ps.updated_at ASC
    LIMIT p_limit
  LOOP
    -- Cooldown: skip if recently attempted (5 min)
    IF v_rec.last_attempt > now() - interval '5 minutes' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    SELECT sjm.job_types[1] INTO v_job_type
    FROM step_job_mapping sjm
    WHERE sjm.step_key = v_rec.step_key AND array_length(sjm.job_types, 1) > 0;
    IF v_job_type IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM step_dag_edges dag
      JOIN package_steps dep ON dep.package_id = v_rec.package_id AND dep.step_key = dag.depends_on
      WHERE dag.step_key = v_rec.step_key AND dep.status NOT IN ('done'::step_status,'skipped'::step_status)
    ) INTO v_has_unmet_deps;
    IF v_has_unmet_deps THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    BEGIN
      SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
        v_job_type, v_rec.package_id, 0, 3, now(),
        jsonb_build_object('package_id', v_rec.package_id, 'curriculum_id', v_rec.curriculum_id, 'step_key', v_rec.step_key)
      );
      IF v_enqueue_result.created THEN
        v_healed := v_healed + 1;
        -- Stamp attempt marker on success too
        UPDATE package_steps
        SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('last_enqueue_attempt', now())
        WHERE id = v_rec.step_id;
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('orphan_queued_heal','fn_heal_orphan_queued_steps','package_step',v_rec.package_id::text,'enqueued',
                'Healed orphan queued step '||v_rec.step_key,
                jsonb_build_object('package_id',v_rec.package_id,'step_key',v_rec.step_key,'job_type',v_job_type));
      ELSE
        -- HARD-FIX: do NOT revert to pending_enqueue. Keep in 'queued', stamp cooldown marker.
        v_pending := v_pending + 1;
        UPDATE package_steps
        SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
              'last_enqueue_attempt', now(),
              'last_enqueue_reject_reason', COALESCE(v_enqueue_result.status,'enqueue_rejected')
            )
        WHERE id = v_rec.step_id;
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('orphan_queued_dedup_cooldown','fn_heal_orphan_queued_steps','package_step',v_rec.package_id::text,'cooldown',
                'Enqueue rejected, keeping step queued with 5min cooldown',
                jsonb_build_object('package_id',v_rec.package_id,'step_key',v_rec.step_key,'reason',COALESCE(v_enqueue_result.status,'enqueue_rejected')));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO admin_actions(action, scope, payload)
  VALUES ('orphan_queued_heal_run','system',
          jsonb_build_object('healed',v_healed,'cooldown_skipped',v_pending,'skipped',v_skipped,'limit',p_limit,'ran_at',now()));

  RETURN jsonb_build_object('ok',true,'healed',v_healed,'cooldown',v_pending,'skipped',v_skipped);
END;
$function$;