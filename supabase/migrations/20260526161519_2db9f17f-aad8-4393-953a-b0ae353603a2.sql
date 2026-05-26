
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'queued_tail_reconciler_v2_cron_tick',
  ARRAY['ran','enqueued','candidates','elapsed_ms']::text[],
  'p74b_reconciler_v2_1'
)
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    owner_module  = EXCLUDED.owner_module,
    updated_at    = now();

CREATE OR REPLACE FUNCTION public.fn_queued_tail_reconciler_v2_cron_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key   bigint := hashtextextended('queued_tail_reconciler_v2_cron_tick', 0);
  v_got_lock   boolean;
  v_started    timestamptz := clock_timestamp();
  v_rows       jsonb;
  v_enqueued   int := 0;
  v_candidates int := 0;
BEGIN
  v_got_lock := pg_try_advisory_lock(v_lock_key);

  IF NOT v_got_lock THEN
    PERFORM public.fn_emit_audit(
      'queued_tail_reconciler_v2_cron_tick',
      jsonb_build_object(
        'ran', false, 'enqueued', 0, 'candidates', 0, 'elapsed_ms', 0,
        'lock_acquired', false, 'reason', 'parallel_run_in_progress'
      )
    );
    RETURN jsonb_build_object('ran', false, 'reason', 'lock_busy');
  END IF;

  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      INTO v_rows
    FROM public.admin_reconcile_queued_tail_without_job_v2(
      p_dry_run := false,
      p_limit   := 25,
      p_override_package_ids := NULL,
      p_override_reason := NULL
    ) t;

    v_candidates := COALESCE(jsonb_array_length(v_rows), 0);
    SELECT COUNT(*) INTO v_enqueued
      FROM jsonb_array_elements(v_rows) e
     WHERE COALESCE(e->>'action','') = 'enqueued';

    PERFORM public.fn_emit_audit(
      'queued_tail_reconciler_v2_cron_tick',
      jsonb_build_object(
        'ran', true, 'enqueued', v_enqueued, 'candidates', v_candidates,
        'elapsed_ms', (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int,
        'lock_acquired', true
      )
    );

    PERFORM pg_advisory_unlock(v_lock_key);
    RETURN jsonb_build_object('ran', true, 'enqueued', v_enqueued, 'candidates', v_candidates);

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_emit_audit(
      'queued_tail_reconciler_v2_cron_tick',
      jsonb_build_object(
        'ran', true, 'enqueued', 0, 'candidates', 0,
        'elapsed_ms', (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int,
        'lock_acquired', true, 'error', SQLERRM
      )
    );
    PERFORM pg_advisory_unlock(v_lock_key);
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_queued_tail_reconciler_v2_cron_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_queued_tail_reconciler_v2_cron_tick() TO service_role;
