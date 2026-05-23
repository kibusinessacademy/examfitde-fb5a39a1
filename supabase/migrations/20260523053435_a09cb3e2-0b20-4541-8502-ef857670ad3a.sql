
-- 3a Audit-Contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('active_job_reconciled', ARRAY['job_id','reason','prev_status','new_status'], 'p25_active_job_reconcile'),
  ('active_job_cancelled_superseded', ARRAY['job_id','reason'], 'p25_active_job_reconcile')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module = EXCLUDED.owner_module,
      updated_at = now();

-- 3b Klassifikations-View
CREATE OR REPLACE VIEW public.v_active_job_reconciliation AS
WITH base AS (
  SELECT
    jq.id AS job_id,
    jq.job_type,
    jq.status,
    jq.attempts,
    jq.max_attempts,
    jq.package_id,
    jq.payload,
    jq.meta,
    jq.run_after,
    jq.last_heartbeat_at,
    jq.locked_at,
    jq.created_at,
    jq.parent_job_id,
    COALESCE(jq.payload->>'step_key', jq.meta->>'step_key') AS step_key
  FROM public.job_queue jq
  WHERE jq.status IN ('pending','processing')
),
step_status AS (
  SELECT b.job_id, ps.status::text AS step_status
  FROM base b
  LEFT JOIN public.package_steps ps
    ON ps.package_id = b.package_id AND ps.step_key = b.step_key
),
downstream_done AS (
  SELECT b.job_id, bool_or(ps.status::text = 'done') AS any_downstream_done
  FROM base b
  LEFT JOIN public.step_dag_edges e ON e.depends_on = b.step_key
  LEFT JOIN public.package_steps ps ON ps.package_id = b.package_id AND ps.step_key = e.step_key
  WHERE b.step_key IS NOT NULL
  GROUP BY b.job_id
),
sibling AS (
  SELECT b.job_id,
    EXISTS (
      SELECT 1 FROM public.job_queue jq2
      WHERE jq2.id <> b.job_id
        AND jq2.package_id = b.package_id
        AND jq2.job_type = b.job_type
        AND jq2.status IN ('pending','processing')
        AND COALESCE(jq2.payload->>'step_key','') = COALESCE(b.step_key,'')
    ) AS has_active_sibling
  FROM base b
)
SELECT
  b.job_id,
  b.job_type,
  b.status,
  b.attempts,
  b.max_attempts,
  b.package_id,
  b.step_key,
  b.run_after,
  b.last_heartbeat_at,
  b.created_at,
  ss.step_status,
  COALESCE(dd.any_downstream_done, false) AS any_downstream_done,
  sib.has_active_sibling,
  CASE
    WHEN b.status = 'processing'
         AND b.last_heartbeat_at IS NOT NULL
         AND b.last_heartbeat_at > now() - interval '5 minutes'
      THEN 'HEALTHY_ACTIVE'
    WHEN b.status = 'processing'
         AND (b.last_heartbeat_at IS NULL OR b.last_heartbeat_at < now() - interval '10 minutes')
      THEN 'STALE_PROCESSING'
    WHEN ss.step_status = 'done'
      THEN 'ORPHANED_ACTIVE'
    WHEN COALESCE(dd.any_downstream_done, false) = true
      THEN 'DAG_SUPERSEDED'
    WHEN b.status = 'pending'
         AND b.attempts >= b.max_attempts
      THEN 'TERMINAL_DRIFT'
    WHEN b.status = 'pending'
         AND COALESCE(b.run_after, b.created_at) < now() - interval '30 minutes'
         AND b.attempts < b.max_attempts
         AND NOT sib.has_active_sibling
      THEN 'RETRYABLE_STUCK'
    ELSE 'HEALTHY_ACTIVE'
  END AS class
FROM base b
LEFT JOIN step_status ss USING (job_id)
LEFT JOIN downstream_done dd USING (job_id)
LEFT JOIN sibling sib USING (job_id);

REVOKE ALL ON public.v_active_job_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_active_job_reconciliation TO service_role;

-- 3c Reconcile-Dispatch-RPC
CREATE OR REPLACE FUNCTION public.admin_active_job_reconcile_dispatch(
  p_dry_run boolean DEFAULT true,
  p_max_actions int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin boolean;
  r record;
  v_actions int := 0;
  v_reset int := 0; v_cancel int := 0; v_requeue int := 0; v_skip int := 0;
  v_details jsonb := '[]'::jsonb;
  v_new_job_id uuid;
  v_idem text;
  v_skip_reason text;
BEGIN
  v_admin := has_role(auth.uid(),'admin'::app_role);
  IF NOT v_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  IF p_max_actions < 1 OR p_max_actions > 200 THEN
    RAISE EXCEPTION 'MAX_ACTIONS_OUT_OF_RANGE: 1..200 (got %)', p_max_actions;
  END IF;

  FOR r IN
    SELECT * FROM public.v_active_job_reconciliation
    WHERE class IN ('STALE_PROCESSING','ORPHANED_ACTIVE','DAG_SUPERSEDED','RETRYABLE_STUCK')
    ORDER BY
      CASE class
        WHEN 'STALE_PROCESSING' THEN 1
        WHEN 'ORPHANED_ACTIVE' THEN 2
        WHEN 'DAG_SUPERSEDED' THEN 3
        WHEN 'RETRYABLE_STUCK' THEN 4
      END,
      created_at ASC
    LIMIT p_max_actions
  LOOP
    EXIT WHEN v_actions >= p_max_actions;

    IF r.class = 'STALE_PROCESSING' THEN
      IF NOT p_dry_run THEN
        UPDATE public.job_queue
           SET status = 'pending', locked_at = NULL, locked_by = NULL,
               last_heartbeat_at = NULL, updated_at = now()
         WHERE id = r.job_id AND status = 'processing';
      END IF;
      v_reset := v_reset + 1;
      IF NOT p_dry_run THEN
        PERFORM public.fn_emit_audit('active_job_reconciled','job', r.job_id::text, 'success',
          jsonb_build_object('job_id', r.job_id, 'reason','zombie_processing',
                             'prev_status','processing','new_status','pending',
                             'package_id', r.package_id, 'step_key', r.step_key),
          'manual');
      END IF;

    ELSIF r.class IN ('ORPHANED_ACTIVE','DAG_SUPERSEDED') THEN
      IF NOT p_dry_run THEN
        UPDATE public.job_queue
           SET status = 'cancelled',
               last_error = 'reconcile:'||lower(r.class),
               completed_at = now(),
               updated_at = now()
         WHERE id = r.job_id AND status IN ('pending','processing');
      END IF;
      v_cancel := v_cancel + 1;
      IF NOT p_dry_run THEN
        PERFORM public.fn_emit_audit('active_job_cancelled_superseded','job', r.job_id::text, 'success',
          jsonb_build_object('job_id', r.job_id, 'reason', lower(r.class),
                             'package_id', r.package_id, 'step_key', r.step_key,
                             'downstream_step', CASE WHEN r.class='DAG_SUPERSEDED' THEN r.step_key ELSE NULL END),
          'manual');
      END IF;

    ELSIF r.class = 'RETRYABLE_STUCK' THEN
      v_skip_reason := NULL;
      IF r.has_active_sibling THEN
        v_skip_reason := 'has_active_sibling';
      ELSIF r.package_id IS NOT NULL AND public.fn_is_bronze_locked(r.package_id) THEN
        v_skip_reason := 'bronze_locked';
      END IF;

      IF v_skip_reason IS NOT NULL THEN
        v_skip := v_skip + 1;
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'job_id', r.job_id, 'class', r.class, 'action','skipped','reason', v_skip_reason));
        v_actions := v_actions + 1;
        CONTINUE;
      END IF;

      v_idem := 'requeue:active_job_reconcile:'||r.job_id::text;
      IF NOT p_dry_run THEN
        INSERT INTO public.job_queue (
          job_type, status, payload, attempts, max_attempts,
          package_id, parent_job_id, idempotency_key, meta, priority
        )
        SELECT
          jq.job_type, 'pending', jq.payload, 0, jq.max_attempts,
          jq.package_id, jq.id, v_idem,
          COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
            'requeue_reason','retryable_stuck_reconcile',
            'enqueue_source','active_job_reconcile',
            'parent_job_id', jq.id,
            'requeued_at', now()
          ),
          jq.priority
        FROM public.job_queue jq
        WHERE jq.id = r.job_id
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_new_job_id;

        IF v_new_job_id IS NOT NULL THEN
          UPDATE public.job_queue
             SET status = 'cancelled',
                 last_error = 'reconciled_requeue',
                 completed_at = now(),
                 updated_at = now()
           WHERE id = r.job_id AND status = 'pending';

          PERFORM public.fn_emit_audit('active_job_reconciled','job', r.job_id::text, 'success',
            jsonb_build_object('job_id', r.job_id, 'reason','retryable_stuck_requeued',
                               'prev_status','pending','new_status','cancelled',
                               'new_job_id', v_new_job_id,
                               'idempotency_key', v_idem,
                               'package_id', r.package_id, 'step_key', r.step_key),
            'manual');
        END IF;
      END IF;
      v_requeue := v_requeue + 1;
    END IF;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'job_id', r.job_id, 'class', r.class,
      'action', CASE r.class
        WHEN 'STALE_PROCESSING' THEN 'reset_to_pending'
        WHEN 'ORPHANED_ACTIVE' THEN 'cancelled_superseded'
        WHEN 'DAG_SUPERSEDED' THEN 'cancelled_superseded'
        WHEN 'RETRYABLE_STUCK' THEN 'requeue_with_contract'
      END,
      'package_id', r.package_id, 'step_key', r.step_key,
      'idempotency_key', CASE WHEN r.class='RETRYABLE_STUCK' THEN v_idem ELSE NULL END
    ));
    v_actions := v_actions + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'actions', v_actions,
    'reset_to_pending', v_reset,
    'cancelled_superseded', v_cancel,
    'requeued', v_requeue,
    'skipped', v_skip,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_active_job_reconcile_dispatch(boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_active_job_reconcile_dispatch(boolean, int) TO authenticated, service_role;

-- 3d Cockpit-Read-RPC
CREATE OR REPLACE FUNCTION public.admin_get_active_job_reconciliation(p_limit_per_class int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin boolean;
  v_counts jsonb;
  v_examples jsonb;
BEGIN
  v_admin := has_role(auth.uid(),'admin'::app_role);
  IF NOT v_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT COALESCE(jsonb_object_agg(class, cnt), '{}'::jsonb) INTO v_counts
  FROM (
    SELECT class, count(*) AS cnt
    FROM public.v_active_job_reconciliation
    GROUP BY class
  ) t;

  SELECT COALESCE(jsonb_object_agg(class, examples), '{}'::jsonb) INTO v_examples
  FROM (
    SELECT class, jsonb_agg(row_to_json(j)) AS examples
    FROM (
      SELECT class, job_id, job_type, package_id, step_key, status, attempts,
             max_attempts, run_after, last_heartbeat_at, created_at,
             row_number() OVER (PARTITION BY class ORDER BY created_at ASC) AS rn
      FROM public.v_active_job_reconciliation
    ) j
    WHERE rn <= GREATEST(1, LEAST(p_limit_per_class, 50))
    GROUP BY class
  ) e;

  RETURN jsonb_build_object(
    'counts', v_counts,
    'examples', v_examples,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_active_job_reconciliation(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_active_job_reconciliation(int) TO authenticated, service_role;
