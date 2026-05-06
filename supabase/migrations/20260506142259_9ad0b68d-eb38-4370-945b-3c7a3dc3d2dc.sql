
CREATE OR REPLACE FUNCTION public.admin_content_gap_topup_dispatch(
  p_package_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_approved int;
  v_shortfall int;
  v_active_jobs int;
  v_attempts int;
  v_job_id uuid;
  v_idem text;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT cp.* INTO v_pkg FROM course_packages cp WHERE cp.id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id;
  END IF;

  IF v_pkg.blocked_reason IS DISTINCT FROM 'auto_heal_zombie' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NOT_ZOMBIE_BLOCKED',
      'blocked_reason', v_pkg.blocked_reason, 'status', v_pkg.status);
  END IF;

  SELECT count(*)::int INTO v_approved
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_pkg.curriculum_id AND eq.status = 'approved';

  IF v_approved >= 50 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_AT_MIN',
      'approved', v_approved, 'hint', 'call admin_content_gap_audit_recheck to unblock');
  END IF;

  v_shortfall := 50 - v_approved;

  SELECT count(*)::int INTO v_active_jobs
  FROM job_queue
  WHERE package_id = p_package_id
    AND status IN ('pending','processing')
    AND job_type IN ('package_repair_exam_pool_quality',
                     'package_repair_exam_pool_competency_coverage',
                     'package_repair_exam_pool_lf_coverage',
                     'package_generate_exam_pool');

  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ACTIVE_REPAIR_PENDING',
      'active_jobs', v_active_jobs, 'approved', v_approved, 'shortfall', v_shortfall);
  END IF;

  v_attempts := COALESCE((v_pkg.feature_flags->'content_gap_topup'->>'attempts')::int, 0);
  v_idem := 'content_gap_topup:' || p_package_id::text || ':' || (v_attempts + 1)::text;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'would_enqueue', true,
      'package_id', p_package_id, 'approved', v_approved, 'shortfall', v_shortfall,
      'attempt', v_attempts + 1, 'idempotency_key', v_idem);
  END IF;

  INSERT INTO job_queue (
    job_type, package_id, status, priority, payload, meta, idempotency_key, lane, worker_pool
  )
  VALUES (
    'package_repair_exam_pool_quality',
    p_package_id,
    'pending',
    7,
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_pkg.curriculum_id,
      'mode', 'targeted',
      'is_repair', true,
      'enqueue_source', 'content_gap_topup',
      'reason', 'below_min_approved_questions',
      'target_min_approved', 50,
      'current_approved', v_approved,
      'shortfall', v_shortfall,
      'attempt', v_attempts + 1
    ),
    jsonb_build_object('content_gap_topup', true, 'attempt', v_attempts + 1),
    v_idem,
    'recovery',
    'default'
  )
  RETURNING id INTO v_job_id;

  UPDATE course_packages
     SET feature_flags = jsonb_set(
           COALESCE(feature_flags, '{}'::jsonb),
           '{content_gap_topup}',
           jsonb_build_object(
             'attempts', v_attempts + 1,
             'last_dispatched_at', now(),
             'last_shortfall', v_shortfall,
             'last_job_id', v_job_id
           ),
           true)
   WHERE id = p_package_id;

  INSERT INTO auto_heal_log (
    trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata
  )
  VALUES (
    'admin_content_gap_topup_dispatch',
    'content_gap_topup_enqueued',
    p_package_id::text, 'package', 'success',
    'Targeted exam-pool top-up enqueued (no status bypass)',
    jsonb_build_object(
      'package_id', p_package_id, 'curriculum_id', v_pkg.curriculum_id,
      'approved_before', v_approved, 'shortfall', v_shortfall,
      'attempt', v_attempts + 1, 'job_id', v_job_id
    )
  );

  RETURN jsonb_build_object('dispatched', true, 'job_id', v_job_id,
    'package_id', p_package_id, 'approved', v_approved, 'shortfall', v_shortfall,
    'attempt', v_attempts + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_content_gap_audit_recheck(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_approved int;
  v_council_job uuid;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT cp.* INTO v_pkg FROM course_packages cp WHERE cp.id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id;
  END IF;

  SELECT count(*)::int INTO v_approved
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_pkg.curriculum_id AND eq.status = 'approved';

  IF v_approved < 50 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'STILL_BELOW_MIN',
      'approved', v_approved, 'shortfall', 50 - v_approved);
  END IF;

  IF v_pkg.blocked_reason = 'auto_heal_zombie' THEN
    UPDATE course_packages
       SET blocked_reason = NULL,
           status = CASE WHEN status IN ('blocked','queued') THEN 'building' ELSE status END,
           feature_flags = jsonb_set(
             COALESCE(feature_flags, '{}'::jsonb),
             '{content_gap_topup,resolved_at}',
             to_jsonb(now()::text), true)
     WHERE id = p_package_id;
  END IF;

  INSERT INTO job_queue (job_type, package_id, status, priority, payload, idempotency_key, lane, worker_pool)
  VALUES (
    'package_quality_council', p_package_id, 'pending', 6,
    jsonb_build_object('package_id', p_package_id, 'enqueue_source', 'content_gap_audit_recheck'),
    'content_gap_recheck:' || p_package_id::text || ':' || extract(epoch from now())::bigint,
    'core', 'default'
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_council_job;

  INSERT INTO auto_heal_log (
    trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata
  )
  VALUES (
    'admin_content_gap_audit_recheck',
    'content_gap_unblock_and_recheck',
    p_package_id::text, 'package', 'success',
    'Approved≥50 — package unblocked and re-entered audit',
    jsonb_build_object('package_id', p_package_id, 'approved', v_approved, 'council_job_id', v_council_job)
  );

  RETURN jsonb_build_object('unblocked', true, 'approved', v_approved,
    'council_job_id', v_council_job);
END;
$$;
