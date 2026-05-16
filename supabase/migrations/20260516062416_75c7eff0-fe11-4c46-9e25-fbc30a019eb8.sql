CREATE OR REPLACE FUNCTION public.fn_commerce_enqueue_repair(
  p_package_id uuid,
  p_repair_job_type text,
  p_reason text,
  p_audit_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reg record;
  v_idem text;
  v_pkg record;
  v_id uuid;
BEGIN
  SELECT lane, pool INTO v_reg FROM public.ops_job_type_registry
    WHERE job_type = p_repair_job_type AND is_active = true LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id, curriculum_id, package_key INTO v_pkg FROM public.course_packages WHERE id = p_package_id;
  v_idem := format('commerce_repair:%s:%s', p_package_id, p_repair_job_type);

  -- Pre-check: skip if active job with same idem key exists
  IF EXISTS (
    SELECT 1 FROM public.job_queue
    WHERE idempotency_key = v_idem AND status IN ('pending','processing')
  ) THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.job_queue (
      job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta
    )
    VALUES (
      p_repair_job_type, p_repair_job_type, v_reg.lane, COALESCE(v_reg.pool, 'control'),
      p_package_id,
      jsonb_build_object(
        'package_id', p_package_id,
        'curriculum_id', v_pkg.curriculum_id,
        'package_key', v_pkg.package_key,
        'reason', p_reason,
        'source', 'commerce_gate',
        'enqueue_source', 'commerce_gate',
        'audit_id', p_audit_id
      ),
      'pending', v_idem, 5,
      jsonb_build_object('audit_id', p_audit_id, 'source', 'commerce_gate')
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    v_id := NULL;
  END;

  RETURN v_id;
END;
$$;