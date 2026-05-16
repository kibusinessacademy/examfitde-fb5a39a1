
CREATE OR REPLACE FUNCTION public.fn_detect_post_publish_sla_breach(p_sla_minutes int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_breaches int := 0; v_repaired int := 0; v_row record; v_idem text;
BEGIN
  FOR v_row IN
    SELECT package_id, curriculum_id, readiness_state, minutes_since_audit
      FROM public.v_post_publish_readiness
     WHERE minutes_since_audit > p_sla_minutes AND readiness_state <> 'READY'
     LIMIT 50
  LOOP
    v_breaches := v_breaches+1;
    v_idem := format('post_publish_sla:%s:%s', v_row.package_id, to_char(date_trunc('hour',now()),'YYYYMMDDHH24'));
    BEGIN
      INSERT INTO public.job_queue
        (job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta)
      VALUES ('package_post_publish_audit_snapshot','package_post_publish_audit_snapshot',
              'growth','core', v_row.package_id,
              jsonb_build_object('package_id',v_row.package_id,'curriculum_id',v_row.curriculum_id,
                                 'source','sla_breach_auto_repair','enqueue_source','sla_breach_auto_repair'),
              'pending', v_idem, 4,
              jsonb_build_object('source','sla_breach','sla_minutes',p_sla_minutes,'state',v_row.readiness_state));
      v_repaired := v_repaired+1;
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('post_publish_orchestrator','system','sla_detector',
    CASE WHEN v_breaches=0 THEN 'noop' ELSE 'ok' END,
    jsonb_build_object('sla_minutes',p_sla_minutes,'breaches',v_breaches,'auto_repaired',v_repaired));
  RETURN jsonb_build_object('ok',true,'sla_minutes',p_sla_minutes,'breaches',v_breaches,'auto_repaired',v_repaired);
END $$;
