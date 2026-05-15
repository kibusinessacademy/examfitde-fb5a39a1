
CREATE OR REPLACE FUNCTION public.admin_dispatch_variant_approval_bridge(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_lf_count int := 0;
  v_review_total int := 0;
  v_idem text;
  v_existing_job uuid;
  v_new_job uuid;
  v_pkg_status text;
  v_curr uuid;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT status, curriculum_id INTO v_pkg_status, v_curr FROM course_packages WHERE id = p_package_id;
  IF v_pkg_status IS NULL THEN
    RETURN jsonb_build_object('skipped',true,'reason','package_not_found');
  END IF;
  IF v_curr IS NULL THEN
    RETURN jsonb_build_object('skipped',true,'reason','curriculum_id_missing');
  END IF;

  SELECT count(*), COALESCE(sum(review_variant_count),0)
  INTO v_lf_count, v_review_total
  FROM v_exam_pool_lf_repair_gap_classification
  WHERE package_id = p_package_id AND variant_pipeline_state = 'AWAITING_APPROVAL';

  IF v_lf_count = 0 THEN
    RETURN jsonb_build_object('skipped',true,'reason','no_awaiting_approval_lfs','package_id',p_package_id);
  END IF;

  SELECT id INTO v_existing_job
  FROM job_queue
  WHERE job_type='package_validate_blueprint_variants'
    AND (payload->>'package_id')::uuid = p_package_id
    AND status IN ('pending','processing')
  LIMIT 1;
  IF v_existing_job IS NOT NULL THEN
    RETURN jsonb_build_object('skipped',true,'reason','active_job_exists','existing_job_id',v_existing_job);
  END IF;

  v_idem := 'var_appr_bridge:' || p_package_id::text || ':' || to_char(now(),'YYYYMMDDHH24');
  IF EXISTS (SELECT 1 FROM job_queue WHERE idempotency_key = v_idem) THEN
    RETURN jsonb_build_object('skipped',true,'reason','idempotency_hit','idempotency_key',v_idem);
  END IF;

  INSERT INTO job_queue (job_type, status, priority, run_after, payload, meta, idempotency_key, package_id, worker_pool, job_name)
  VALUES (
    'package_validate_blueprint_variants','pending',7,now(),
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_curr,
      '_origin','variant_approval_bridge',
      'enqueue_source','variant_approval_bridge',
      'awaiting_approval_lf_count', v_lf_count,
      'review_variant_total', v_review_total
    ),
    jsonb_build_object('enqueue_source','variant_approval_bridge'),
    v_idem, p_package_id, 'core',
    'validate_variants_approval_bridge'
  ) RETURNING id INTO v_new_job;

  INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, metadata)
  VALUES ('admin_rpc','variant_approval_bridge_enqueued', p_package_id::text, 'course_package','enqueued',
    jsonb_build_object('package_id',p_package_id,'job_id',v_new_job,'idempotency_key',v_idem,
      'awaiting_approval_lf_count',v_lf_count,'review_variant_total',v_review_total));

  RETURN jsonb_build_object('enqueued',true,'job_id',v_new_job,'lf_count',v_lf_count,'review_total',v_review_total);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_variant_approval_bridge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_variant_approval_bridge(uuid) TO authenticated, service_role;
