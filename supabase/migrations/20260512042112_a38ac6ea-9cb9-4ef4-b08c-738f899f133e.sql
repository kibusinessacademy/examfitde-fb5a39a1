
-- ============================================================
-- Pipeline Failure Drilldown + Repair-with-Audit (before/after)
-- ============================================================

-- 1) Pipeline failure drilldown (top clusters last 1h)
CREATE OR REPLACE FUNCTION public.admin_get_pipeline_failure_drilldown(
  p_window_minutes int DEFAULT 60,
  p_limit int DEFAULT 25
)
RETURNS TABLE(
  job_type text,
  error_code text,
  error_sample text,
  failure_count bigint,
  affected_packages bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  sample_job_ids uuid[],
  classification text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      j.job_type,
      COALESCE(NULLIF(j.last_error_code,''),'NO_CODE') AS error_code,
      LEFT(COALESCE(j.last_error,''), 160) AS error_sample,
      j.id AS job_id,
      j.package_id,
      j.created_at,
      j.updated_at,
      j.last_error
    FROM public.job_queue j
    WHERE j.status='failed'
      AND j.updated_at > now() - make_interval(mins => p_window_minutes)
  )
  SELECT
    b.job_type,
    b.error_code,
    b.error_sample,
    COUNT(*)::bigint AS failure_count,
    COUNT(DISTINCT b.package_id)::bigint AS affected_packages,
    MIN(b.updated_at) AS first_seen,
    MAX(b.updated_at) AS last_seen,
    (ARRAY_AGG(b.job_id ORDER BY b.updated_at DESC))[1:5] AS sample_job_ids,
    CASE
      WHEN b.error_code IN ('BRONZE_LOCKED','PHANTOM_BLOCKED','REENTRY_GUARD','GUARD_BLOCKED') THEN 'expected_guard'
      WHEN b.error_code ILIKE '%TIMEOUT%' OR b.error_code ILIKE '%CPU%' OR b.error_code='WORKER_KILLED' THEN 'infra_transient'
      WHEN b.error_code ILIKE '%RATE_LIMIT%' OR b.error_code ILIKE '%429%' THEN 'rate_limit'
      WHEN b.error_code='NO_CODE' AND COALESCE(MAX(b.last_error),'')='' THEN 'unclassified_silent'
      WHEN b.job_type LIKE 'package_%' THEN 'pipeline_blocker'
      ELSE 'other'
    END AS classification
  FROM base b
  GROUP BY b.job_type, b.error_code, b.error_sample
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_pipeline_failure_drilldown(int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pipeline_failure_drilldown(int,int) TO authenticated, service_role;

-- 2) Repair-with-Audit: before/after grant snapshot, returns run_id
CREATE OR REPLACE FUNCTION public.admin_repair_order_with_audit(
  p_order_id uuid,
  p_caller_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_run_id uuid := gen_random_uuid();
  v_uid uuid;
  v_before jsonb;
  v_after jsonb;
  v_status text := 'success';
  v_err text := NULL;
  v_curricula uuid[];
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id required';
  END IF;

  SELECT COALESCE(o.learner_user_id, o.buyer_user_id)
    INTO v_uid
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'order not found or has no buyer/learner: %', p_order_id;
  END IF;

  SELECT ARRAY_AGG(DISTINCT p.curriculum_id) FILTER (WHERE p.curriculum_id IS NOT NULL)
    INTO v_curricula
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id;

  -- BEFORE snapshot
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'curriculum_id', g.curriculum_id,
           'status', g.status,
           'has_full_access', g.has_full_access,
           'valid_until', g.valid_until
         )), '[]'::jsonb)
    INTO v_before
  FROM public.learner_course_grants g
  WHERE g.user_id = v_uid
    AND g.curriculum_id = ANY(COALESCE(v_curricula, ARRAY[]::uuid[]));

  BEGIN
    PERFORM public.process_order_paid_fulfillment(p_order_id);
  EXCEPTION WHEN others THEN
    v_status := 'error';
    v_err := SQLERRM;
  END;

  -- AFTER snapshot
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'curriculum_id', g.curriculum_id,
           'status', g.status,
           'has_full_access', g.has_full_access,
           'valid_until', g.valid_until
         )), '[]'::jsonb)
    INTO v_after
  FROM public.learner_course_grants g
  WHERE g.user_id = v_uid
    AND g.curriculum_id = ANY(COALESCE(v_curricula, ARRAY[]::uuid[]));

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'admin_repair_order_with_audit',
    'order',
    p_order_id::text,
    v_status,
    jsonb_build_object(
      'run_id', v_run_id,
      'caller_id', v_caller,
      'order_id', p_order_id,
      'user_id', v_uid,
      'curricula', to_jsonb(v_curricula),
      'grants_before', v_before,
      'grants_after', v_after,
      'error', v_err
    )
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'order_id', p_order_id,
    'user_id', v_uid,
    'status', v_status,
    'error', v_err,
    'curricula', to_jsonb(v_curricula),
    'grants_before', v_before,
    'grants_after', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_repair_order_with_audit(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_repair_order_with_audit(uuid,uuid) TO authenticated, service_role;
