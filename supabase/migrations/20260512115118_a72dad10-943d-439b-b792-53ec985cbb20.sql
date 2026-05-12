CREATE OR REPLACE FUNCTION public.admin_drain_queued_tail_auto(
  p_max_batches      int  DEFAULT 5,
  p_batch_size       int  DEFAULT 10,
  p_sleep_seconds    int  DEFAULT 30,
  p_min_bronze_clean int  DEFAULT 0,
  p_stop_on_failure  bool DEFAULT true
)
RETURNS TABLE(
  batch_no       int,
  enqueued_count int,
  gate_snapshot  jsonb,
  stopped_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service bool := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
  v_uid uuid       := auth.uid();
  v_i  int := 0;
  v_n  int;
  v_snap jsonb;
  v_clean_count int;
  v_stop text := NULL;
  v_failure_classes text[] := ARRAY[
    'POOL_GAP_REPAIR','BLOOM_GAP_REPAIR','TRAP_GAP_REPAIR'
  ];
  v_new_failures int;
  v_baseline_failures int;
BEGIN
  IF NOT v_is_service AND (v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  -- Baseline failure count (pre-drain)
  SELECT count(*) INTO v_baseline_failures
  FROM public.v_publish_readiness_gate
  WHERE gate_class = ANY(v_failure_classes);

  WHILE v_i < p_max_batches LOOP
    v_i := v_i + 1;

    -- Pre-check: stop if BRONZE_REVIEW_CLEAN below threshold
    SELECT count(*) INTO v_clean_count
    FROM public.v_publish_readiness_gate
    WHERE gate_class = 'BRONZE_REVIEW_CLEAN';

    IF v_clean_count <= p_min_bronze_clean THEN
      v_stop := format('bronze_clean_drained:%s<=%s', v_clean_count, p_min_bronze_clean);
      EXIT;
    END IF;

    -- Run reconciler batch
    SELECT count(*) INTO v_n
    FROM public.admin_reconcile_queued_tail_without_job(false, p_batch_size);

    -- Snapshot gate distribution
    SELECT jsonb_object_agg(gate_class, n) INTO v_snap
    FROM (
      SELECT gate_class, count(*) AS n
      FROM public.v_publish_readiness_gate
      GROUP BY gate_class
    ) s;

    -- Failure-class growth check
    SELECT count(*) INTO v_new_failures
    FROM public.v_publish_readiness_gate
    WHERE gate_class = ANY(v_failure_classes);

    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'auto_drain_batch','system',NULL,
      CASE WHEN v_n=0 THEN 'noop' ELSE 'success' END,
      format('batch %s/%s enqueued=%s clean=%s failures=%s(baseline %s)',
             v_i, p_max_batches, v_n, v_clean_count, v_new_failures, v_baseline_failures),
      jsonb_build_object(
        'batch_no', v_i,
        'enqueued_count', v_n,
        'gate_snapshot', v_snap,
        'bronze_clean_remaining', v_clean_count - v_n,
        'failure_classes_count', v_new_failures,
        'baseline_failures', v_baseline_failures
      )
    );

    batch_no       := v_i;
    enqueued_count := v_n;
    gate_snapshot  := v_snap;
    stopped_reason := NULL;
    RETURN NEXT;

    -- Stop conditions
    IF v_n = 0 THEN
      v_stop := 'empty_batch';
      EXIT;
    END IF;

    IF p_stop_on_failure AND v_new_failures > v_baseline_failures THEN
      v_stop := format('failure_class_growth:%s>%s', v_new_failures, v_baseline_failures);
      EXIT;
    END IF;

    -- Inter-batch sleep (DB-side)
    IF v_i < p_max_batches AND p_sleep_seconds > 0 THEN
      PERFORM pg_sleep(p_sleep_seconds);
    END IF;
  END LOOP;

  -- Final summary row
  SELECT jsonb_object_agg(gate_class, n) INTO v_snap
  FROM (
    SELECT gate_class, count(*) AS n
    FROM public.v_publish_readiness_gate
    GROUP BY gate_class
  ) s;

  batch_no       := -1;
  enqueued_count := 0;
  gate_snapshot  := v_snap;
  stopped_reason := COALESCE(v_stop, 'max_batches_reached');
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_drain_queued_tail_auto(int,int,int,int,bool) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_drain_queued_tail_auto(int,int,int,int,bool) TO service_role;