-- =========================================================
-- Pricing Blocker: actionable AI heal + sustainable default repair
-- =========================================================

-- 1) Audit view for current pricing gaps (service-only, admin via RPC)
CREATE OR REPLACE VIEW public.v_pricing_gap_audit AS
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  cp.track::text AS track,
  cp.curriculum_id,
  cp.product_id,
  p.title AS product_title,
  p.status AS product_status,
  p.visibility AS product_visibility,
  COUNT(pp.id) FILTER (WHERE pp.active = true)::int AS active_price_count,
  COUNT(pp.id) FILTER (WHERE pp.active = true AND pp.stripe_price_id IS NOT NULL)::int AS active_stripe_price_count,
  CASE
    WHEN cp.product_id IS NULL THEN 'PACKAGE_PRODUCT_ID_MISSING'
    WHEN p.id IS NULL THEN 'PRODUCT_ROW_MISSING'
    WHEN COUNT(pp.id) FILTER (WHERE pp.active = true) = 0 THEN 'NO_ACTIVE_PRICE'
    WHEN COUNT(pp.id) FILTER (WHERE pp.active = true AND pp.stripe_price_id IS NOT NULL) = 0 THEN 'STRIPE_PRICE_ID_MISSING'
    ELSE 'OK'
  END AS gap_type,
  now() AS evaluated_at
FROM public.course_packages cp
LEFT JOIN public.products p ON p.id = cp.product_id
LEFT JOIN public.product_prices pp ON pp.product_id = cp.product_id
WHERE cp.status IN ('building','queued','blocked','published')
GROUP BY cp.id, cp.title, cp.status, cp.track, cp.curriculum_id, cp.product_id, p.id, p.title, p.status, p.visibility;

REVOKE ALL ON public.v_pricing_gap_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pricing_gap_audit TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_pricing_gap_audit(p_only_gaps boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_summary jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_object_agg(gap_type, n), '{}'::jsonb)
  INTO v_summary
  FROM (
    SELECT gap_type, COUNT(*)::int AS n
    FROM public.v_pricing_gap_audit
    WHERE (NOT p_only_gaps OR gap_type <> 'OK')
    GROUP BY gap_type
  ) s;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.gap_type, r.package_status, r.package_title), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM public.v_pricing_gap_audit
    WHERE (NOT p_only_gaps OR gap_type <> 'OK')
    LIMIT 250
  ) r;

  RETURN jsonb_build_object(
    'summary', COALESCE(v_summary, '{}'::jsonb),
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'generated_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_pricing_gap_audit(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_pricing_gap_audit(boolean) TO authenticated;

-- 2) Per-package pricing repair. Uses current bundle-only SSOT: 24,90 EUR / 12 months / one-time.
CREATE OR REPLACE FUNCTION public.admin_repair_package_default_pricing(
  p_package_id uuid,
  p_reason text DEFAULT 'admin_pricing_repair'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_product record;
  v_price_id uuid;
  v_default_stripe_price_id text := 'price_1TKgFDDxqdaWCpJ6cquKeCog';
  v_default_amount_cents int := 2490;
  v_ready_before boolean := false;
  v_ready_after boolean := false;
  v_updated_price boolean := false;
  v_inserted_price boolean := false;
  v_product_unarchived boolean := false;
  v_step_reset boolean := false;
  v_job_enqueued boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT cp.* INTO v_pkg
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found', 'package_id', p_package_id);
  END IF;

  IF v_pkg.product_id IS NULL THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('pricing_default_repair', 'course_package', p_package_id::text, 'skipped',
      jsonb_build_object('reason', 'package_product_id_missing', 'triggered_by', v_uid, 'input_reason', p_reason));
    RETURN jsonb_build_object('ok', false, 'error', 'package_product_id_missing', 'package_id', p_package_id);
  END IF;

  SELECT p.* INTO v_product
  FROM public.products p
  WHERE p.id = v_pkg.product_id;

  IF NOT FOUND THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('pricing_default_repair', 'course_package', p_package_id::text, 'skipped',
      jsonb_build_object('reason', 'product_row_missing', 'product_id', v_pkg.product_id, 'triggered_by', v_uid, 'input_reason', p_reason));
    RETURN jsonb_build_object('ok', false, 'error', 'product_row_missing', 'package_id', p_package_id, 'product_id', v_pkg.product_id);
  END IF;

  SELECT public.fn_package_has_active_stripe_price(p_package_id) INTO v_ready_before;

  IF v_product.status = 'archived' AND COALESCE(v_product.active_package_id, p_package_id) = p_package_id THEN
    UPDATE public.products
    SET status = 'draft', visibility = COALESCE(visibility, 'private'), updated_at = now()
    WHERE id = v_product.id;
    v_product_unarchived := true;
  END IF;

  SELECT pp.id INTO v_price_id
  FROM public.product_prices pp
  WHERE pp.product_id = v_pkg.product_id
    AND pp.active = true
    AND pp.amount_cents = v_default_amount_cents
  ORDER BY pp.updated_at DESC NULLS LAST, pp.created_at DESC
  LIMIT 1;

  IF v_price_id IS NOT NULL THEN
    UPDATE public.product_prices
    SET stripe_price_id = COALESCE(NULLIF(stripe_price_id, ''), v_default_stripe_price_id),
        currency = COALESCE(currency, 'EUR'),
        billing_type = COALESCE(billing_type, 'one_time'),
        access_months = COALESCE(access_months, 12),
        updated_at = now()
    WHERE id = v_price_id
      AND (stripe_price_id IS NULL OR stripe_price_id = '' OR currency IS NULL OR billing_type IS NULL OR access_months IS NULL);
    GET DIAGNOSTICS v_updated_price = ROW_COUNT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_prices pp
    WHERE pp.product_id = v_pkg.product_id
      AND pp.active = true
      AND pp.stripe_price_id IS NOT NULL
  ) THEN
    INSERT INTO public.product_prices(product_id, currency, amount_cents, billing_type, access_months, active, stripe_price_id)
    VALUES (v_pkg.product_id, 'EUR', v_default_amount_cents, 'one_time', 12, true, v_default_stripe_price_id)
    RETURNING id INTO v_price_id;
    v_inserted_price := true;
  END IF;

  SELECT public.fn_package_has_active_stripe_price(p_package_id) INTO v_ready_after;

  IF v_ready_after THEN
    UPDATE public.course_packages
    SET blocked_reason = CASE WHEN blocked_reason = 'pricing_config_missing' THEN NULL ELSE blocked_reason END,
        stuck_reason = CASE WHEN stuck_reason ILIKE '%PRICING_HARD_GATE%' THEN NULL ELSE stuck_reason END,
        updated_at = now()
    WHERE id = p_package_id;

    UPDATE public.package_steps
    SET status = 'queued'::public.step_status,
        attempts = 0,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'pricing_repaired_at', now(),
          'pricing_repaired_by', v_uid,
          'pricing_repair_reason', p_reason,
          'reset_reason', 'pricing_default_repair'
        ),
        updated_at = now()
    WHERE package_id = p_package_id
      AND step_key = 'auto_publish'
      AND status::text IN ('queued','failed','blocked','cancelled','retry_scheduled');
    GET DIAGNOSTICS v_step_reset = ROW_COUNT;

    IF NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = p_package_id
        AND jq.job_type = 'package_auto_publish'
        AND jq.status IN ('pending','queued','processing','running','retry_scheduled')
    ) THEN
      INSERT INTO public.job_queue(job_type, package_id, status, priority, payload, meta, worker_pool, lane, job_name, idempotency_key)
      VALUES (
        'package_auto_publish',
        p_package_id,
        'pending',
        10,
        jsonb_build_object(
          'package_id', p_package_id,
          'curriculum_id', v_pkg.curriculum_id,
          'step_key', 'auto_publish',
          'enqueue_source', 'pricing_default_repair',
          'source', 'admin_repair_package_default_pricing'
        ),
        jsonb_build_object(
          'step_key', 'auto_publish',
          'enqueue_source', 'pricing_default_repair',
          'pricing_repaired_at', now(),
          'pricing_repaired_by', v_uid
        ),
        'core',
        'control',
        'package_auto_publish',
        'pricing_repair:auto_publish:' || p_package_id::text
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_job_enqueued = ROW_COUNT;
    END IF;
  END IF;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('pricing_default_repair', 'admin_repair_package_default_pricing', 'course_package', p_package_id::text,
    CASE WHEN v_ready_after THEN 'success' ELSE 'failed' END,
    jsonb_build_object(
      'package_title', v_pkg.title,
      'product_id', v_pkg.product_id,
      'ready_before', v_ready_before,
      'ready_after', v_ready_after,
      'price_id', v_price_id,
      'updated_price', v_updated_price,
      'inserted_price', v_inserted_price,
      'product_unarchived', v_product_unarchived,
      'auto_publish_step_reset', v_step_reset,
      'auto_publish_job_enqueued', v_job_enqueued,
      'stripe_price_id', v_default_stripe_price_id,
      'triggered_by', v_uid,
      'input_reason', p_reason
    ));

  RETURN jsonb_build_object(
    'ok', v_ready_after,
    'package_id', p_package_id,
    'product_id', v_pkg.product_id,
    'ready_before', v_ready_before,
    'ready_after', v_ready_after,
    'updated_price', v_updated_price,
    'inserted_price', v_inserted_price,
    'product_unarchived', v_product_unarchived,
    'auto_publish_step_reset', v_step_reset,
    'auto_publish_job_enqueued', v_job_enqueued,
    'stripe_price_id', v_default_stripe_price_id
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_repair_package_default_pricing(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_package_default_pricing(uuid,text) TO authenticated;

-- 3) Make AI recommendation apply actionable for pricing clusters.
CREATE OR REPLACE FUNCTION public.admin_heal_apply_recommendation(
  p_recommendation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_step jsonb;
  v_action text;
  v_params jsonb;
  v_pkg_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_step_result jsonb;
  v_steps_executed int := 0;
  v_steps_failed int := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT id, pattern_key, cluster, package_id, heal_plan, status
  INTO v_rec
  FROM public.heal_pattern_recommendations
  WHERE id = p_recommendation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','recommendation_not_found');
  END IF;

  IF v_rec.status = 'applied' THEN
    RETURN jsonb_build_object('error','already_applied','recommendation_id', v_rec.id);
  END IF;

  v_pkg_id := v_rec.package_id;

  IF v_rec.heal_plan IS NULL OR jsonb_typeof(v_rec.heal_plan->'steps') <> 'array' THEN
    RETURN jsonb_build_object('error','no_heal_plan');
  END IF;

  FOR v_step IN SELECT * FROM jsonb_array_elements(v_rec.heal_plan->'steps')
  LOOP
    v_action := v_step->>'action';
    v_params := COALESCE(v_step->'params', '{}'::jsonb);
    v_step_result := jsonb_build_object('action', v_action);

    BEGIN
      IF v_action IN ('repair_pricing','sync_pricing','repair_package_pricing','backfill_pricing')
         OR (v_action = 'manual_review' AND v_rec.cluster = 'publish_enqueue_blocked_no_pricing') THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          v_step_result := v_step_result || jsonb_build_object(
            'status','ok',
            'detail','repair_package_default_pricing',
            'result', public.admin_repair_package_default_pricing(v_pkg_id, COALESCE(v_step->>'why','heal_apply: pricing repair'))
          );
          v_steps_executed := v_steps_executed + 1;
        END IF;

      ELSIF v_action = 'soft_reentry' OR v_action = 'soft_heal' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
          v_step_result := v_step_result || jsonb_build_object('status','ok','detail','nudge_atomic_trigger');
          v_steps_executed := v_steps_executed + 1;
        END IF;

      ELSIF v_action = 'hard_heal' OR v_action = 'reset_to_step' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          DECLARE
            v_step_key text := COALESCE(v_params->>'step_key', v_params->>'step', '');
          BEGIN
            IF v_step_key = '' THEN
              PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
              v_step_result := v_step_result || jsonb_build_object('status','ok','detail','nudge_atomic (no step_key)');
            ELSE
              PERFORM public.admin_retry_failed_step(v_pkg_id, v_step_key, COALESCE(v_step->>'why','heal_apply'));
              v_step_result := v_step_result || jsonb_build_object('status','ok','detail','retry_failed_step:'||v_step_key);
            END IF;
            v_steps_executed := v_steps_executed + 1;
          END;
        END IF;

      ELSIF v_action = 'mark_content_gap' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          PERFORM public.admin_mark_content_gap(v_pkg_id, COALESCE(v_step->>'why','heal_apply: content gap'));
          v_step_result := v_step_result || jsonb_build_object('status','ok','detail','mark_content_gap');
          v_steps_executed := v_steps_executed + 1;
        END IF;

      ELSIF v_action = 'force_depublish_rebuild' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          UPDATE public.course_packages
            SET status = 'queued',
                published_at = NULL,
                updated_at = now()
          WHERE id = v_pkg_id;
          PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
          v_step_result := v_step_result || jsonb_build_object('status','ok','detail','depublish+rebuild');
          v_steps_executed := v_steps_executed + 1;
        END IF;

      ELSIF v_action = 'manual_review' THEN
        v_step_result := v_step_result || jsonb_build_object('status','noop','detail','manual_review_logged');

      ELSE
        v_step_result := v_step_result || jsonb_build_object('status','unknown_action');
      END IF;
    EXCEPTION WHEN others THEN
      v_step_result := v_step_result || jsonb_build_object('status','error','error', SQLERRM);
      v_steps_failed := v_steps_failed + 1;
    END;

    v_results := v_results || v_step_result;
  END LOOP;

  IF v_steps_executed = 0 AND v_steps_failed = 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_id, target_type, result_status, result_detail, metadata)
    VALUES (
      'heal_recommendation_no_actionable_steps',
      'admin',
      COALESCE(v_pkg_id::text, v_rec.pattern_key),
      CASE WHEN v_pkg_id IS NOT NULL THEN 'package' ELSE 'pattern' END,
      'skipped',
      'No executable heal step was found',
      jsonb_build_object('recommendation_id', p_recommendation_id, 'pattern_key', v_rec.pattern_key, 'cluster', v_rec.cluster, 'steps', v_results)
    );
    RETURN jsonb_build_object('error','no_actionable_steps','executed',0,'failed',0,'steps',v_results);
  END IF;

  UPDATE public.heal_pattern_recommendations
    SET status = 'applied',
        applied_at = now(),
        applied_by = v_uid,
        apply_result = jsonb_build_object('executed', v_steps_executed, 'failed', v_steps_failed, 'steps', v_results),
        updated_at = now()
  WHERE id = p_recommendation_id;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_id, target_type, result_status, result_detail, metadata)
  VALUES (
    'heal_recommendation_applied',
    'admin',
    COALESCE(v_pkg_id::text, v_rec.pattern_key),
    CASE WHEN v_pkg_id IS NOT NULL THEN 'package' ELSE 'pattern' END,
    CASE WHEN v_steps_failed = 0 THEN 'success' ELSE 'partial' END,
    format('executed=%s failed=%s', v_steps_executed, v_steps_failed),
    jsonb_build_object(
      'recommendation_id', p_recommendation_id,
      'pattern_key', v_rec.pattern_key,
      'cluster', v_rec.cluster,
      'admin_uid', v_uid,
      'steps', v_results
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'executed', v_steps_executed,
    'failed', v_steps_failed,
    'steps', v_results
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_heal_apply_recommendation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_apply_recommendation(uuid) TO authenticated;

-- 4) One-time repair for current package/product gaps caused by default bundle price missing.
DO $$
DECLARE
  r record;
  v_system uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  -- Active public products without any active price get the bundle default price.
  INSERT INTO public.product_prices(product_id, currency, amount_cents, billing_type, access_months, active, stripe_price_id)
  SELECT p.id, 'EUR', 2490, 'one_time', 12, true, 'price_1TKgFDDxqdaWCpJ6cquKeCog'
  FROM public.products p
  WHERE p.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.product_prices pp
      WHERE pp.product_id = p.id AND pp.active = true
    );

  -- Active rows at the bundle amount but missing the Stripe price are completed.
  UPDATE public.product_prices pp
  SET stripe_price_id = 'price_1TKgFDDxqdaWCpJ6cquKeCog',
      currency = COALESCE(pp.currency, 'EUR'),
      billing_type = COALESCE(pp.billing_type, 'one_time'),
      access_months = COALESCE(pp.access_months, 12),
      updated_at = now()
  FROM public.products p
  WHERE p.id = pp.product_id
    AND pp.active = true
    AND pp.amount_cents = 2490
    AND (pp.stripe_price_id IS NULL OR pp.stripe_price_id = '')
    AND (
      p.status = 'active'
      OR EXISTS (
        SELECT 1 FROM public.course_packages cp
        WHERE cp.product_id = p.id
          AND cp.status IN ('building','queued','blocked','published')
      )
    );

  -- Resurrect archived product rows only when they are still the active package backing row.
  UPDATE public.products p
  SET status = 'draft', visibility = COALESCE(p.visibility, 'private'), updated_at = now()
  WHERE p.status = 'archived'
    AND EXISTS (
      SELECT 1 FROM public.course_packages cp
      WHERE cp.product_id = p.id
        AND cp.id = p.active_package_id
        AND cp.status IN ('building','queued','blocked')
    );

  -- Reset/enqueue currently blocked auto_publish steps after pricing became ready.
  FOR r IN
    SELECT cp.id, cp.curriculum_id, cp.title
    FROM public.course_packages cp
    WHERE cp.status IN ('building','queued','blocked')
      AND public.fn_package_has_active_stripe_price(cp.id)
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key = 'auto_publish'
          AND ps.status::text IN ('queued','failed','blocked','cancelled','retry_scheduled')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.job_type = 'package_auto_publish'
          AND jq.status IN ('pending','queued','processing','running','retry_scheduled')
      )
  LOOP
    UPDATE public.package_steps
    SET status = 'queued'::public.step_status,
        attempts = 0,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'pricing_repaired_at', now(),
          'pricing_repaired_by', 'migration_20260506',
          'reset_reason', 'pricing_default_repair_migration'
        ),
        updated_at = now()
    WHERE package_id = r.id AND step_key = 'auto_publish';

    INSERT INTO public.job_queue(job_type, package_id, status, priority, payload, meta, worker_pool, lane, job_name, idempotency_key)
    VALUES (
      'package_auto_publish',
      r.id,
      'pending',
      10,
      jsonb_build_object('package_id', r.id, 'curriculum_id', r.curriculum_id, 'step_key', 'auto_publish', 'enqueue_source', 'pricing_default_repair_migration'),
      jsonb_build_object('step_key', 'auto_publish', 'enqueue_source', 'pricing_default_repair_migration', 'pricing_repaired_at', now()),
      'core',
      'control',
      'package_auto_publish',
      'pricing_repair:auto_publish:' || r.id::text
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('pricing_default_repair_migration', 'system', 'success', jsonb_build_object(
    'default_amount_cents', 2490,
    'stripe_price_id', 'price_1TKgFDDxqdaWCpJ6cquKeCog',
    'note', 'Completed active bundle pricing rows and re-enqueued eligible auto_publish steps',
    'ran_at', now()
  ));
END $$;