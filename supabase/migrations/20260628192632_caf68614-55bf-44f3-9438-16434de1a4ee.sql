
-- =========================================================================
-- PUBLISH.PIPELINE.GATE.OBSERVABILITY.OS.1
-- Read-only classifier for silent BEFORE INSERT drops + dispatcher upgrade
-- =========================================================================

-- 1) Classifier RPC ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_classify_publish_silent_drop(
  p_package_id uuid,
  p_queue_id uuid DEFAULT NULL,
  p_lookback_seconds int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_log record;
  v_pkg record;
  v_reason text;
  v_detail text;
  v_source text := 'audit_lookback';
BEGIN
  -- Step 1: look for the most-recent skip/block from any BEFORE INSERT guard
  --         on this package within the lookback window.
  SELECT action_type, result_status, metadata, created_at
  INTO v_log
  FROM public.auto_heal_log
  WHERE target_id = p_package_id::text
    AND created_at >= now() - make_interval(secs => p_lookback_seconds)
    AND result_status IN ('skipped','blocked','cancelled')
    AND action_type IN (
      'auto_publish_blocked_council_deferred',
      'publish_enqueue_blocked_no_pricing',
      'bronze_locked_enqueue_blocked',
      'producer_source_missing_blocked',
      'orphan_heal_phantom_blocked',
      'dag_guard_block',
      'dag_guard_loop_detected'
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_reason := CASE v_log.action_type
      WHEN 'auto_publish_blocked_council_deferred' THEN 'COUNCIL_DEFERRED'
      WHEN 'publish_enqueue_blocked_no_pricing'   THEN 'PRICING_HARD_GATE_PRECONDITION'
      WHEN 'bronze_locked_enqueue_blocked'        THEN 'BRONZE_LOCKED_REQUIRES_REVIEW'
      WHEN 'producer_source_missing_blocked'      THEN 'PRODUCER_SOURCE_MISSING'
      WHEN 'orphan_heal_phantom_blocked'          THEN 'ORPHAN_HEAL_REQUIRES_BUILDING'
      WHEN 'dag_guard_block'                      THEN 'DAG_PREREQUISITES_MISSING'
      WHEN 'dag_guard_loop_detected'              THEN 'DAG_GUARD_LOOP_DETECTED'
      ELSE 'PUBLISH_GATE_BLOCKED'
    END;
    RETURN jsonb_build_object(
      'reason_code', v_reason,
      'source', v_source,
      'audit_action_type', v_log.action_type,
      'audit_at', v_log.created_at,
      'audit_metadata', COALESCE(v_log.metadata, '{}'::jsonb)
    );
  END IF;

  -- Step 2: fallback — deterministic precondition probes (read-only).
  SELECT cp.id, cp.product_id, cp.blocked_reason, cp.status,
         public.fn_package_has_active_stripe_price(cp.id) AS has_price,
         EXISTS (SELECT 1 FROM public.council_defer_log
                  WHERE package_id = cp.id AND cleared_at IS NULL) AS council_deferred,
         public.fn_is_bronze_locked(cp.id) AS bronze_locked
  INTO v_pkg
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('reason_code','PACKAGE_NOT_FOUND','source','probe');
  END IF;

  v_source := 'probe';
  IF v_pkg.product_id IS NULL THEN
    v_reason := 'BLOCKED_PUBLISH_NO_PRODUCT';
  ELSIF v_pkg.bronze_locked THEN
    v_reason := 'BRONZE_LOCKED_REQUIRES_REVIEW';
  ELSIF v_pkg.council_deferred THEN
    v_reason := 'COUNCIL_DEFERRED';
  ELSIF NOT v_pkg.has_price THEN
    v_reason := 'PRICING_HARD_GATE_PRECONDITION';
  ELSE
    v_reason := 'UNKNOWN_SILENT_DROP';
  END IF;

  RETURN jsonb_build_object(
    'reason_code', v_reason,
    'source', v_source,
    'probe', jsonb_build_object(
      'product_id', v_pkg.product_id,
      'has_active_price', v_pkg.has_price,
      'council_deferred', v_pkg.council_deferred,
      'bronze_locked', v_pkg.bronze_locked,
      'package_status', v_pkg.status,
      'blocked_reason', v_pkg.blocked_reason
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_classify_publish_silent_drop(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_classify_publish_silent_drop(uuid, uuid, int) TO service_role;

-- 2) Dispatcher upgrade -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dispatch_sellable_heal_queue(
  p_cap integer DEFAULT 20,
  p_dry_run boolean DEFAULT true,
  p_heal_action text DEFAULT 'publish_course_package'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_silent_drops int := 0;
  v_candidates int := 0;
  v_actions jsonb := '[]'::jsonb;
  v_classification jsonb;
  v_reason text;
  v_reason_counts jsonb := '{}'::jsonb;
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

    IF v_row.attempts >= 3 THEN
      v_manual := v_manual + 1;
      v_actions := v_actions || jsonb_build_object(
        'queue_id', v_row.id, 'package_id', v_row.package_id,
        'action', 'manual_review', 'attempts', v_row.attempts
      );
      IF NOT p_dry_run THEN
        UPDATE public.admin_course_auto_heal_queue
          SET status='manual_review', last_error='attempts_exceeded', updated_at=now()
        WHERE id = v_row.id AND status='pending';
        INSERT INTO public.auto_heal_log(
          trigger_source, action_type, target_id, target_type,
          input_params, result_status, result_detail, metadata
        ) VALUES (
          'sellable_dispatcher_os1_rpc','dispatcher_manual_review',
          v_row.package_id::text,'course_package',
          jsonb_build_object('queue_id', v_row.id, 'attempts', v_row.attempts),
          'manual_review','attempts_exceeded',
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
      SET status='processing', attempts=v_row.attempts + 1,
          claim_token=gen_random_uuid(), updated_at=now()
    WHERE id = v_row.id AND status='pending'
    RETURNING id INTO v_row.id;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      v_actions := v_actions || jsonb_build_object('queue_id', v_row.id, 'action', 'skipped_claim_lost');
      CONTINUE;
    END IF;
    v_claimed := v_claimed + 1;

    v_idem := 'sellable_dispatcher_os1:' || v_row.package_id::text || ':' || v_row.id::text;
    v_job_id := NULL;

    BEGIN
      INSERT INTO public.job_queue (
        job_type, job_name, status, priority, package_id, idempotency_key, payload
      ) VALUES (
        'package_auto_publish','package_auto_publish','pending',10,
        v_row.package_id, v_idem,
        jsonb_build_object(
          'package_id', v_row.package_id,
          'curriculum_id', v_row.curriculum_id,
          'step_key','auto_publish',
          'enqueue_source','sellable_dispatcher_os1',
          'queue_id', v_row.id,
          'reason_codes', coalesce(to_jsonb(v_row.reason_codes), '[]'::jsonb)
        )
      )
      RETURNING id INTO v_job_id;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      UPDATE public.admin_course_auto_heal_queue
        SET status='failed', last_error=SQLERRM, updated_at=now()
      WHERE id = v_row.id;
      v_actions := v_actions || jsonb_build_object(
        'queue_id', v_row.id, 'package_id', v_row.package_id,
        'action','enqueue_failed','error',SQLERRM
      );
      INSERT INTO public.auto_heal_log(
        trigger_source, action_type, target_id, target_type,
        input_params, result_status, error_message
      ) VALUES (
        'sellable_dispatcher_os1_rpc','dispatcher_failed',
        v_row.package_id::text,'course_package',
        jsonb_build_object('queue_id', v_row.id, 'idempotency_key', v_idem),
        'failed', SQLERRM
      );
      CONTINUE;
    END;

    IF v_job_id IS NULL THEN
      -- BEFORE INSERT trigger returned NULL → silent drop. Classify & audit.
      v_silent_drops := v_silent_drops + 1;
      v_classification := public.admin_classify_publish_silent_drop(v_row.package_id, v_row.id, 30);
      v_reason := COALESCE(v_classification->>'reason_code', 'UNKNOWN_SILENT_DROP');
      v_reason_counts := v_reason_counts
        || jsonb_build_object(v_reason, COALESCE((v_reason_counts->>v_reason)::int, 0) + 1);

      UPDATE public.admin_course_auto_heal_queue
        SET status='manual_review',
            last_error=v_reason,
            updated_at=now()
      WHERE id = v_row.id;

      INSERT INTO public.auto_heal_log(
        trigger_source, action_type, target_id, target_type,
        input_params, result_status, result_detail, metadata
      ) VALUES (
        'sellable_dispatcher_os1_rpc',
        'dispatcher_silent_drop_classified',
        v_row.package_id::text, 'course_package',
        jsonb_build_object('queue_id', v_row.id, 'idempotency_key', v_idem),
        'manual_review', v_reason,
        jsonb_build_object(
          'reason_code', v_reason,
          'classification', v_classification,
          'curriculum_id', v_row.curriculum_id,
          'idempotency_key', v_idem
        )
      );

      v_actions := v_actions || jsonb_build_object(
        'queue_id', v_row.id, 'package_id', v_row.package_id,
        'action','silent_drop_classified','reason', v_reason
      );
      CONTINUE;
    END IF;

    -- Real enqueue path
    UPDATE public.admin_course_auto_heal_queue
      SET status='done', last_dispatched_job_id=v_job_id,
          dispatched_at=now(), processed_at=now(),
          last_error=NULL, updated_at=now()
    WHERE id = v_row.id;

    v_enqueued := v_enqueued + 1;
    v_actions := v_actions || jsonb_build_object(
      'queue_id', v_row.id, 'package_id', v_row.package_id,
      'action','enqueued','job_id', v_job_id
    );

    INSERT INTO public.auto_heal_log(
      trigger_source, action_type, target_id, target_type,
      input_params, result_status, result_detail, metadata
    ) VALUES (
      'sellable_dispatcher_os1_rpc','dispatcher_completed',
      v_row.package_id::text,'course_package',
      jsonb_build_object('queue_id', v_row.id, 'curriculum_id', v_row.curriculum_id),
      'completed','job_enqueued',
      jsonb_build_object('job_id', v_job_id, 'idempotency_key', v_idem)
    );
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
      'dispatcher_manual_review', v_manual,
      'dispatcher_silent_drops', v_silent_drops,
      'dispatcher_silent_drop_reasons', v_reason_counts
    ),
    'actions', v_actions
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_dispatch_sellable_heal_queue(integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_sellable_heal_queue(integer, boolean, text) TO service_role;
