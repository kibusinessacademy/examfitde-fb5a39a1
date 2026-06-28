
-- SELLABLE.DISPATCHER.OS.1: SECURITY DEFINER RPC mirror of edge dispatcher so pg_cron can run it
CREATE OR REPLACE FUNCTION public.admin_dispatch_sellable_heal_queue(
  p_cap integer DEFAULT 20,
  p_dry_run boolean DEFAULT true,
  p_heal_action text DEFAULT 'publish_course_package'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap integer := greatest(1, least(coalesce(p_cap, 20), 50));
  v_row record;
  v_job_id uuid;
  v_idem text;
  v_claimed int := 0;
  v_enqueued int := 0;
  v_failed int := 0;
  v_manual int := 0;
  v_skipped int := 0;
  v_candidates int := 0;
  v_actions jsonb := '[]'::jsonb;
BEGIN
  IF p_heal_action <> 'publish_course_package' THEN
    RAISE EXCEPTION 'unsupported_heal_action: %', p_heal_action USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT id, package_id, curriculum_id, heal_action, attempts, reason_codes
    FROM public.admin_course_auto_heal_queue
    WHERE status = 'pending'
      AND heal_action = p_heal_action
    ORDER BY created_at ASC
    LIMIT v_cap
  LOOP
    v_candidates := v_candidates + 1;

    -- guard: too many attempts -> manual_review
    IF v_row.attempts >= 3 THEN
      v_manual := v_manual + 1;
      v_actions := v_actions || jsonb_build_object(
        'queue_id', v_row.id, 'package_id', v_row.package_id,
        'action', 'manual_review', 'attempts', v_row.attempts
      );
      IF NOT p_dry_run THEN
        UPDATE public.admin_course_auto_heal_queue
          SET status = 'manual_review',
              last_error = 'attempts_exceeded',
              updated_at = now()
        WHERE id = v_row.id AND status = 'pending';

        INSERT INTO public.auto_heal_log(
          trigger_source, action_type, target_id, target_type,
          input_params, result_status, result_detail, metadata
        ) VALUES (
          'sellable_dispatcher_os1_rpc',
          'dispatcher_manual_review',
          v_row.package_id::text, 'course_package',
          jsonb_build_object('queue_id', v_row.id, 'attempts', v_row.attempts),
          'manual_review', 'attempts_exceeded',
          jsonb_build_object('max_attempts', 3)
        );
      END IF;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_claimed := v_claimed + 1;
      v_enqueued := v_enqueued + 1;
      v_actions := v_actions || jsonb_build_object(
        'queue_id', v_row.id, 'package_id', v_row.package_id, 'action', 'would_enqueue'
      );
      CONTINUE;
    END IF;

    -- atomic claim
    UPDATE public.admin_course_auto_heal_queue
      SET status = 'processing',
          attempts = v_row.attempts + 1,
          claim_token = gen_random_uuid(),
          updated_at = now()
    WHERE id = v_row.id AND status = 'pending'
    RETURNING id INTO v_row.id;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      v_actions := v_actions || jsonb_build_object('queue_id', v_row.id, 'action', 'skipped_claim_lost');
      CONTINUE;
    END IF;
    v_claimed := v_claimed + 1;

    v_idem := 'sellable_dispatcher_os1:' || v_row.package_id::text || ':' || v_row.id::text;

    BEGIN
      INSERT INTO public.job_queue (
        job_type, job_name, status, priority, package_id, idempotency_key, payload
      ) VALUES (
        'package_auto_publish', 'package_auto_publish', 'pending', 10,
        v_row.package_id, v_idem,
        jsonb_build_object(
          'package_id', v_row.package_id,
          'curriculum_id', v_row.curriculum_id,
          'step_key', 'auto_publish',
          'enqueue_source', 'sellable_dispatcher_os1',
          'queue_id', v_row.id,
          'reason_codes', coalesce(to_jsonb(v_row.reason_codes), '[]'::jsonb)
        )
      )
      RETURNING id INTO v_job_id;

      UPDATE public.admin_course_auto_heal_queue
        SET status = 'done',
            last_dispatched_job_id = v_job_id,
            dispatched_at = now(),
            processed_at = now(),
            last_error = NULL,
            updated_at = now()
      WHERE id = v_row.id;

      v_enqueued := v_enqueued + 1;
      v_actions := v_actions || jsonb_build_object(
        'queue_id', v_row.id, 'package_id', v_row.package_id,
        'action', 'enqueued', 'job_id', v_job_id
      );

      INSERT INTO public.auto_heal_log(
        trigger_source, action_type, target_id, target_type,
        input_params, result_status, result_detail, metadata
      ) VALUES (
        'sellable_dispatcher_os1_rpc',
        'dispatcher_completed',
        v_row.package_id::text, 'course_package',
        jsonb_build_object('queue_id', v_row.id, 'curriculum_id', v_row.curriculum_id),
        'completed', 'job_enqueued',
        jsonb_build_object('job_id', v_job_id, 'idempotency_key', v_idem)
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      UPDATE public.admin_course_auto_heal_queue
        SET status = 'pending', last_error = SQLERRM, updated_at = now()
      WHERE id = v_row.id;
      v_actions := v_actions || jsonb_build_object(
        'queue_id', v_row.id, 'package_id', v_row.package_id,
        'action', 'enqueue_failed', 'error', SQLERRM
      );
      INSERT INTO public.auto_heal_log(
        trigger_source, action_type, target_id, target_type,
        input_params, result_status, error_message
      ) VALUES (
        'sellable_dispatcher_os1_rpc',
        'dispatcher_failed',
        v_row.package_id::text, 'course_package',
        jsonb_build_object('queue_id', v_row.id, 'idempotency_key', v_idem),
        'failed', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'metrics', jsonb_build_object(
      'dry_run', p_dry_run,
      'cap', v_cap,
      'heal_action', p_heal_action,
      'candidates', v_candidates,
      'dispatcher_claimed', v_claimed,
      'dispatcher_enqueued', v_enqueued,
      'dispatcher_failed', v_failed,
      'dispatcher_skipped', v_skipped,
      'dispatcher_manual_review', v_manual
    ),
    'actions', v_actions
  );
END
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_sellable_heal_queue(integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_sellable_heal_queue(integer, boolean, text) TO service_role;
