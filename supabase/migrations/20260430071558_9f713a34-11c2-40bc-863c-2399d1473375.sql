CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.system_intent_record(
  p_intent_type text, p_package_id uuid DEFAULT NULL,
  p_priority int DEFAULT 100, p_payload jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_sig text; v_id uuid;
BEGIN
  v_sig := encode(extensions.digest(p_intent_type||':'||COALESCE(p_package_id::text,'-')||':'||p_payload::text,'sha256'),'hex');
  INSERT INTO system_intents(intent_type,package_id,priority,payload,signature,source)
  VALUES (p_intent_type,p_package_id,p_priority,p_payload,v_sig,p_source)
  ON CONFLICT (signature) WHERE consumed_at IS NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('recorded', v_id IS NOT NULL,'id',v_id,'signature',v_sig);
END $$;

CREATE OR REPLACE FUNCTION public.fn_guard_dag_prerequisites()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE
  v_step_key text; v_missing text; v_signature text;
  v_recent_blocks int; v_loop_threshold int := 50; v_loop_window interval := '1 hour';
BEGIN
  IF NEW.status NOT IN ('pending','queued') THEN RETURN NEW; END IF;
  IF (NEW.meta->>'dag_bypass')::boolean IS TRUE THEN RETURN NEW; END IF;
  IF NEW.job_type NOT LIKE 'package_%' THEN RETURN NEW; END IF;
  v_step_key := substring(NEW.job_type FROM 9);

  SELECT string_agg(dag.depends_on,', ' ORDER BY dag.depends_on) INTO v_missing
  FROM step_dag_edges dag
  JOIN package_steps dep ON dep.package_id=NEW.package_id AND dep.step_key=dag.depends_on
  WHERE dag.step_key=v_step_key AND dep.status NOT IN ('done','skipped');

  IF v_missing IS NULL THEN RETURN NEW; END IF;

  v_signature := encode(extensions.digest(NEW.package_id::text||':'||v_step_key||':'||v_missing,'sha256'),'hex');

  SELECT COUNT(*) INTO v_recent_blocks FROM auto_heal_log
  WHERE action_type='dag_guard_block' AND target_id=NEW.package_id::text
    AND metadata->>'signature'=v_signature AND created_at > now()-v_loop_window;

  IF v_recent_blocks >= v_loop_threshold THEN
    UPDATE package_steps
    SET status='blocked'::step_status,
        last_error='DAG_GUARD_LOOP_DETECTED: '||v_recent_blocks||' identical blocks for missing deps ['||v_missing||']',
        meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
          'dag_guard_loop_detected',true,'block_signature',v_signature,
          'missing_deps',v_missing,'recent_blocks',v_recent_blocks,'detected_at',now())
    WHERE package_id=NEW.package_id AND step_key=v_step_key
      AND status::text NOT IN ('blocked','done','skipped');

    INSERT INTO auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,metadata)
    VALUES ('dag_guard_loop_detected','trg_guard_dag_prerequisites','course_package',NEW.package_id::text,
      'blocked',jsonb_build_object('step_key',v_step_key,'missing_deps',v_missing,
        'signature',v_signature,'recent_blocks',v_recent_blocks));
    RETURN NULL;
  END IF;

  INSERT INTO auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,result_detail,metadata)
  VALUES ('dag_guard_block','trg_guard_dag_prerequisites','job',COALESCE(NEW.package_id::text,'unknown'),
    'blocked','Blocked '||NEW.job_type||': unmet deps = '||v_missing,
    jsonb_build_object('job_type',NEW.job_type,'package_id',NEW.package_id,
      'missing_deps',v_missing,'signature',v_signature,'recent_blocks_in_hour',v_recent_blocks));
  RETURN NULL;
END $$;