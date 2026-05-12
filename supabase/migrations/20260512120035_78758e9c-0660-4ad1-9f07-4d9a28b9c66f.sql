-- =====================================================
-- 1) BRONZE_REVIEW_REQUIRED drain
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_drain_bronze_review_required(
  p_dry boolean DEFAULT false,
  p_limit int DEFAULT 5
) RETURNS TABLE(package_id uuid, action text, detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_allowed bool := (
    COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role'
    OR current_user IN ('postgres','supabase_admin','service_role')
    OR (auth.uid() IS NOT NULL AND has_role(auth.uid(),'admin'::app_role))
  );
  v_wip_cap int := 5;
  v_active int;
  v_enqueued int := 0;
  r record; v_res jsonb;
BEGIN
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_active FROM job_queue
  WHERE job_type='package_elite_harden' AND status IN ('pending','processing')
    AND COALESCE(meta->>'bronze_repair','')='true';

  IF v_active >= v_wip_cap THEN
    INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
    VALUES('drain_bronze_review_batch','system','noop',
      format('wip_cap_reached active=%s cap=%s',v_active,v_wip_cap),
      jsonb_build_object('skipped_reason','wip_cap','active',v_active,'cap',v_wip_cap));
    RETURN;
  END IF;

  FOR r IN
    SELECT g.package_id
    FROM v_publish_readiness_gate g
    JOIN course_packages cp ON cp.id=g.package_id
    WHERE g.gate_class='BRONZE_REVIEW_REQUIRED'
      AND g.bronze_locked = true
      AND g.score BETWEEN 75 AND 84
      AND COALESCE((cp.feature_flags->'bronze'->>'repair_attempts')::int,0) < 1
      AND COALESCE((cp.feature_flags->'bronze'->>'repair_active')::boolean,false) = false
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq WHERE jq.package_id=g.package_id
          AND jq.job_type='package_elite_harden' AND jq.status IN ('pending','processing')
      )
    ORDER BY g.score DESC NULLS LAST
    LIMIT LEAST(p_limit, v_wip_cap - v_active)
  LOOP
    IF p_dry THEN
      package_id := r.package_id; action := 'would_dispatch';
      detail := jsonb_build_object('class','BRONZE_REVIEW_REQUIRED');
      RETURN NEXT;
    ELSE
      BEGIN
        v_res := admin_bronze_targeted_repair_dispatch(r.package_id);
        v_enqueued := v_enqueued + CASE WHEN v_res->>'dispatched'='true' THEN 1 ELSE 0 END;
        package_id := r.package_id;
        action := CASE WHEN v_res->>'dispatched'='true' THEN 'dispatched' ELSE 'skipped' END;
        detail := v_res;
        RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        package_id := r.package_id; action := 'error';
        detail := jsonb_build_object('error',SQLERRM);
        RETURN NEXT;
      END;
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
  VALUES('drain_bronze_review_batch','system',
    CASE WHEN v_enqueued=0 THEN 'noop' ELSE 'success' END,
    format('enqueued=%s active=%s cap=%s dry=%s', v_enqueued, v_active, v_wip_cap, p_dry),
    jsonb_build_object('enqueued',v_enqueued,'active',v_active,'cap',v_wip_cap,'dry',p_dry));
END;
$$;

-- =====================================================
-- 2) NEEDS_INTEGRITY_FIRST drain
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_drain_needs_integrity(
  p_dry boolean DEFAULT false,
  p_limit int DEFAULT 10
) RETURNS TABLE(package_id uuid, action text, detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_allowed bool := (
    COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role'
    OR current_user IN ('postgres','supabase_admin','service_role')
    OR (auth.uid() IS NOT NULL AND has_role(auth.uid(),'admin'::app_role))
  );
  v_wip_cap int := 10;
  v_active int;
  v_enqueued int := 0;
  r record; v_id uuid;
BEGIN
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_active FROM job_queue
  WHERE job_type='package_run_integrity_check' AND status IN ('pending','processing');

  IF v_active >= v_wip_cap THEN
    INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
    VALUES('drain_needs_integrity_batch','system','noop',
      format('wip_cap_reached active=%s cap=%s',v_active,v_wip_cap),
      jsonb_build_object('skipped_reason','wip_cap','active',v_active,'cap',v_wip_cap));
    RETURN;
  END IF;

  FOR r IN
    SELECT g.package_id
    FROM v_publish_readiness_gate g
    WHERE g.gate_class='NEEDS_INTEGRITY_FIRST'
      AND g.has_active_integrity_job = false
      AND g.package_status IN ('building','queued')
    ORDER BY g.approved_total DESC NULLS LAST
    LIMIT LEAST(p_limit, v_wip_cap - v_active)
  LOOP
    IF p_dry THEN
      package_id := r.package_id; action := 'would_enqueue';
      detail := jsonb_build_object('class','NEEDS_INTEGRITY_FIRST','job_type','package_run_integrity_check');
      RETURN NEXT;
    ELSE
      v_id := _admin_recheck_enqueue('package_run_integrity_check', r.package_id, 5,
        jsonb_build_object('enqueue_source','drain_needs_integrity_v1','_origin','drain_orchestrator'));
      IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
      package_id := r.package_id;
      action := CASE WHEN v_id IS NULL THEN 'skipped' ELSE 'enqueued' END;
      detail := jsonb_build_object('job_id',v_id);
      RETURN NEXT;
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
  VALUES('drain_needs_integrity_batch','system',
    CASE WHEN v_enqueued=0 THEN 'noop' ELSE 'success' END,
    format('enqueued=%s active=%s cap=%s dry=%s', v_enqueued, v_active, v_wip_cap, p_dry),
    jsonb_build_object('enqueued',v_enqueued,'active',v_active,'cap',v_wip_cap,'dry',p_dry));
END;
$$;

-- =====================================================
-- 3) POOL_GAP_REPAIR drain
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_drain_pool_gap(
  p_dry boolean DEFAULT false,
  p_limit int DEFAULT 3
) RETURNS TABLE(package_id uuid, action text, detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_allowed bool := (
    COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role'
    OR current_user IN ('postgres','supabase_admin','service_role')
    OR (auth.uid() IS NOT NULL AND has_role(auth.uid(),'admin'::app_role))
  );
  v_wip_cap int := 3;
  v_active int;
  v_enqueued int := 0;
  r record; v_id uuid;
BEGIN
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_active FROM job_queue
  WHERE job_type LIKE 'package_repair_exam_pool%' AND status IN ('pending','processing');

  IF v_active >= v_wip_cap THEN
    INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
    VALUES('drain_pool_gap_batch','system','noop',
      format('wip_cap_reached active=%s cap=%s',v_active,v_wip_cap),
      jsonb_build_object('skipped_reason','wip_cap','active',v_active,'cap',v_wip_cap));
    RETURN;
  END IF;

  FOR r IN
    SELECT g.package_id
    FROM v_publish_readiness_gate g
    WHERE g.gate_class='POOL_GAP_REPAIR'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq WHERE jq.package_id=g.package_id
          AND jq.job_type LIKE 'package_repair_exam_pool%' AND jq.status IN ('pending','processing')
      )
    ORDER BY g.approved_total ASC NULLS FIRST
    LIMIT LEAST(p_limit, v_wip_cap - v_active)
  LOOP
    IF p_dry THEN
      package_id := r.package_id; action := 'would_enqueue';
      detail := jsonb_build_object('class','POOL_GAP_REPAIR','job_type','package_repair_exam_pool_quality');
      RETURN NEXT;
    ELSE
      v_id := _admin_recheck_enqueue('package_repair_exam_pool_quality', r.package_id, 6,
        jsonb_build_object('enqueue_source','drain_pool_gap_v1','_origin','drain_orchestrator'));
      IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
      package_id := r.package_id;
      action := CASE WHEN v_id IS NULL THEN 'skipped' ELSE 'enqueued' END;
      detail := jsonb_build_object('job_id',v_id);
      RETURN NEXT;
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
  VALUES('drain_pool_gap_batch','system',
    CASE WHEN v_enqueued=0 THEN 'noop' ELSE 'success' END,
    format('enqueued=%s active=%s cap=%s dry=%s', v_enqueued, v_active, v_wip_cap, p_dry),
    jsonb_build_object('enqueued',v_enqueued,'active',v_active,'cap',v_wip_cap,'dry',p_dry));
END;
$$;

-- =====================================================
-- 4) TRAP_GAP_REPAIR drain
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_drain_trap_gap(
  p_dry boolean DEFAULT false,
  p_limit int DEFAULT 2
) RETURNS TABLE(package_id uuid, action text, detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_allowed bool := (
    COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role'
    OR current_user IN ('postgres','supabase_admin','service_role')
    OR (auth.uid() IS NOT NULL AND has_role(auth.uid(),'admin'::app_role))
  );
  v_wip_cap int := 2;
  v_active int;
  v_enqueued int := 0;
  r record; v_id uuid;
BEGIN
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_active FROM job_queue
  WHERE job_type='package_exam_rebalance' AND status IN ('pending','processing');

  IF v_active >= v_wip_cap THEN
    INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
    VALUES('drain_trap_gap_batch','system','noop',
      format('wip_cap_reached active=%s cap=%s',v_active,v_wip_cap),
      jsonb_build_object('skipped_reason','wip_cap','active',v_active,'cap',v_wip_cap));
    RETURN;
  END IF;

  FOR r IN
    SELECT g.package_id
    FROM v_publish_readiness_gate g
    WHERE g.gate_class='TRAP_GAP_REPAIR'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq WHERE jq.package_id=g.package_id
          AND jq.job_type='package_exam_rebalance' AND jq.status IN ('pending','processing')
      )
    LIMIT LEAST(p_limit, v_wip_cap - v_active)
  LOOP
    IF p_dry THEN
      package_id := r.package_id; action := 'would_enqueue';
      detail := jsonb_build_object('class','TRAP_GAP_REPAIR','job_type','package_exam_rebalance');
      RETURN NEXT;
    ELSE
      v_id := _admin_recheck_enqueue('package_exam_rebalance', r.package_id, 6,
        jsonb_build_object('enqueue_source','drain_trap_gap_v1','_origin','drain_orchestrator'));
      IF v_id IS NOT NULL THEN v_enqueued := v_enqueued + 1; END IF;
      package_id := r.package_id;
      action := CASE WHEN v_id IS NULL THEN 'skipped' ELSE 'enqueued' END;
      detail := jsonb_build_object('job_id',v_id);
      RETURN NEXT;
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
  VALUES('drain_trap_gap_batch','system',
    CASE WHEN v_enqueued=0 THEN 'noop' ELSE 'success' END,
    format('enqueued=%s active=%s cap=%s dry=%s', v_enqueued, v_active, v_wip_cap, p_dry),
    jsonb_build_object('enqueued',v_enqueued,'active',v_active,'cap',v_wip_cap,'dry',p_dry));
END;
$$;

-- =====================================================
-- 5) Orchestrator
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_drain_class_orchestrator(
  p_dry boolean DEFAULT false
) RETURNS TABLE(class_name text, enqueued int, eligible_total int, stopped_reason text, gate_snapshot jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_allowed bool := (
    COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role'
    OR current_user IN ('postgres','supabase_admin','service_role')
    OR (auth.uid() IS NOT NULL AND has_role(auth.uid(),'admin'::app_role))
  );
  v_health jsonb;
  v_health_ok bool := true;
  v_global_cap int := 20;
  v_total_enqueued int := 0;
  v_snap jsonb;
  v_eligible int;
  v_n int;
  v_kill bool := false;
BEGIN
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Health gate
  BEGIN
    v_health := fn_worker_health_gate();
    v_health_ok := COALESCE((v_health->>'healthy')::bool, true);
  EXCEPTION WHEN OTHERS THEN v_health_ok := true; v_health := jsonb_build_object('error',SQLERRM); END;

  SELECT jsonb_object_agg(gate_class,n) INTO v_snap
  FROM (SELECT gate_class, count(*) AS n FROM v_publish_readiness_gate GROUP BY gate_class) s;

  IF NOT v_health_ok THEN
    INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
    VALUES('drain_orchestrator_run','system','noop','health_gate_red',
      jsonb_build_object('skipped_reason','health_gate_red','health',v_health,'gate_snapshot',v_snap,'dry',p_dry));
    class_name:='ALL'; enqueued:=0; eligible_total:=0;
    stopped_reason:='health_gate_red'; gate_snapshot:=v_snap;
    RETURN NEXT; RETURN;
  END IF;

  -- 1) BRONZE_REVIEW_REQUIRED
  SELECT count(*) INTO v_eligible FROM v_publish_readiness_gate WHERE gate_class='BRONZE_REVIEW_REQUIRED';
  v_n := 0;
  IF v_total_enqueued < v_global_cap AND v_eligible > 0 THEN
    SELECT count(*) FILTER (WHERE action IN ('dispatched','would_dispatch')) INTO v_n
    FROM admin_drain_bronze_review_required(p_dry, LEAST(5, v_global_cap - v_total_enqueued));
    v_total_enqueued := v_total_enqueued + COALESCE(v_n,0);
  END IF;
  class_name:='BRONZE_REVIEW_REQUIRED'; enqueued:=COALESCE(v_n,0); eligible_total:=v_eligible;
  stopped_reason:=CASE WHEN v_eligible=0 THEN 'class_empty' WHEN v_total_enqueued>=v_global_cap THEN 'global_cap' ELSE NULL END;
  gate_snapshot:=v_snap; RETURN NEXT;

  -- 2) NEEDS_INTEGRITY_FIRST
  SELECT count(*) INTO v_eligible FROM v_publish_readiness_gate WHERE gate_class='NEEDS_INTEGRITY_FIRST';
  v_n := 0;
  IF v_total_enqueued < v_global_cap AND v_eligible > 0 THEN
    SELECT count(*) FILTER (WHERE action IN ('enqueued','would_enqueue')) INTO v_n
    FROM admin_drain_needs_integrity(p_dry, LEAST(10, v_global_cap - v_total_enqueued));
    v_total_enqueued := v_total_enqueued + COALESCE(v_n,0);
  END IF;
  class_name:='NEEDS_INTEGRITY_FIRST'; enqueued:=COALESCE(v_n,0); eligible_total:=v_eligible;
  stopped_reason:=CASE WHEN v_eligible=0 THEN 'class_empty' WHEN v_total_enqueued>=v_global_cap THEN 'global_cap' ELSE NULL END;
  gate_snapshot:=v_snap; RETURN NEXT;

  -- 3) POOL_GAP_REPAIR
  SELECT count(*) INTO v_eligible FROM v_publish_readiness_gate WHERE gate_class='POOL_GAP_REPAIR';
  v_n := 0;
  IF v_total_enqueued < v_global_cap AND v_eligible > 0 THEN
    SELECT count(*) FILTER (WHERE action IN ('enqueued','would_enqueue')) INTO v_n
    FROM admin_drain_pool_gap(p_dry, LEAST(3, v_global_cap - v_total_enqueued));
    v_total_enqueued := v_total_enqueued + COALESCE(v_n,0);
  END IF;
  class_name:='POOL_GAP_REPAIR'; enqueued:=COALESCE(v_n,0); eligible_total:=v_eligible;
  stopped_reason:=CASE WHEN v_eligible=0 THEN 'class_empty' WHEN v_total_enqueued>=v_global_cap THEN 'global_cap' ELSE NULL END;
  gate_snapshot:=v_snap; RETURN NEXT;

  -- 4) TRAP_GAP_REPAIR
  SELECT count(*) INTO v_eligible FROM v_publish_readiness_gate WHERE gate_class='TRAP_GAP_REPAIR';
  v_n := 0;
  IF v_total_enqueued < v_global_cap AND v_eligible > 0 THEN
    SELECT count(*) FILTER (WHERE action IN ('enqueued','would_enqueue')) INTO v_n
    FROM admin_drain_trap_gap(p_dry, LEAST(2, v_global_cap - v_total_enqueued));
    v_total_enqueued := v_total_enqueued + COALESCE(v_n,0);
  END IF;
  class_name:='TRAP_GAP_REPAIR'; enqueued:=COALESCE(v_n,0); eligible_total:=v_eligible;
  stopped_reason:=CASE WHEN v_eligible=0 THEN 'class_empty' WHEN v_total_enqueued>=v_global_cap THEN 'global_cap' ELSE NULL END;
  gate_snapshot:=v_snap; RETURN NEXT;

  INSERT INTO auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
  VALUES('drain_orchestrator_run','system',
    CASE WHEN v_total_enqueued=0 THEN 'noop' ELSE 'success' END,
    format('total_enqueued=%s cap=%s dry=%s', v_total_enqueued, v_global_cap, p_dry),
    jsonb_build_object('total_enqueued',v_total_enqueued,'global_cap',v_global_cap,
      'gate_snapshot',v_snap,'health',v_health,'dry',p_dry));
END;
$$;

-- =====================================================
-- 6) Smoke RPC
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_smoke_drain_orchestrator()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_allowed bool := (
    COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role'
    OR current_user IN ('postgres','supabase_admin','service_role')
    OR (auth.uid() IS NOT NULL AND has_role(auth.uid(),'admin'::app_role))
  );
  v_orch jsonb; v_b jsonb; v_n jsonb; v_p jsonb; v_t jsonb;
BEGIN
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_agg(t) INTO v_b FROM admin_drain_bronze_review_required(true, 5) t;
  SELECT jsonb_agg(t) INTO v_n FROM admin_drain_needs_integrity(true, 10) t;
  SELECT jsonb_agg(t) INTO v_p FROM admin_drain_pool_gap(true, 3) t;
  SELECT jsonb_agg(t) INTO v_t FROM admin_drain_trap_gap(true, 2) t;
  SELECT jsonb_agg(t) INTO v_orch FROM admin_drain_class_orchestrator(true) t;

  RETURN jsonb_build_object(
    'ok', true,
    'bronze', COALESCE(v_b,'[]'::jsonb),
    'needs_integrity', COALESCE(v_n,'[]'::jsonb),
    'pool_gap', COALESCE(v_p,'[]'::jsonb),
    'trap_gap', COALESCE(v_t,'[]'::jsonb),
    'orchestrator', COALESCE(v_orch,'[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_drain_bronze_review_required(boolean,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_drain_needs_integrity(boolean,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_drain_pool_gap(boolean,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_drain_trap_gap(boolean,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_drain_class_orchestrator(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_smoke_drain_orchestrator() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_drain_bronze_review_required(boolean,int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_drain_needs_integrity(boolean,int)        TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_drain_pool_gap(boolean,int)               TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_drain_trap_gap(boolean,int)               TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_drain_class_orchestrator(boolean)         TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_smoke_drain_orchestrator()                TO authenticated, anon, service_role;