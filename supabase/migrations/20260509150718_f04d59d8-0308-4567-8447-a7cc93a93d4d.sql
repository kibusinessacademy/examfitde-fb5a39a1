
-- =====================================================================
-- LEITSTELLE BYPASS-HEAL v1
-- One-time + RPC: publish-ready, retriable-requeue, stuck-heal
-- =====================================================================

-- ---------- RPC: admin_leitstelle_bypass_heal ------------------------
CREATE OR REPLACE FUNCTION public.admin_leitstelle_bypass_heal(
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_pub_published int := 0;
  v_pub_pricing_blocked int := 0;
  v_pub_guard_blocked int := 0;
  v_requeued int := 0;
  v_stuck_nudged int := 0;
  v_pkg record;
  v_job record;
  v_err text;
  v_reasons text[];
BEGIN
  -- ───── 1) Publish-Ready bypass-publish ─────
  FOR v_pkg IN
    SELECT r.package_id, r.curriculum_title, p.product_id
    FROM v_admin_publish_readiness r
    JOIN course_packages p ON p.id = r.package_id
    WHERE r.publish_ready = true
      AND r.is_published <> true
      AND r.package_status <> 'published'
  LOOP
    -- Pre-check pricing (avoid noisy guard exception)
    IF NOT EXISTS (
      SELECT 1 FROM product_prices pp
      WHERE pp.product_id = v_pkg.product_id
        AND pp.active = true
        AND pp.stripe_price_id IS NOT NULL
    ) THEN
      v_pub_pricing_blocked := v_pub_pricing_blocked + 1;
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('leitstelle_bypass_publish_skipped','admin_leitstelle_bypass_heal','package',
              v_pkg.package_id::text,'pricing_blocked',
              jsonb_build_object('run_id',v_run_id,'reason','no_active_stripe_price',
                                 'product_id',v_pkg.product_id,'title',v_pkg.curriculum_title));
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_pub_published := v_pub_published + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM set_config('app.transition_source','admin_force_publish', true);
      UPDATE course_packages
         SET status = 'published',
             is_published = true,
             published_at = COALESCE(published_at, now()),
             updated_at = now()
       WHERE id = v_pkg.package_id;
      v_pub_published := v_pub_published + 1;
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('leitstelle_bypass_publish','admin_leitstelle_bypass_heal','package',
              v_pkg.package_id::text,'published',
              jsonb_build_object('run_id',v_run_id,'title',v_pkg.curriculum_title));
    EXCEPTION WHEN OTHERS THEN
      v_pub_guard_blocked := v_pub_guard_blocked + 1;
      v_err := SQLERRM;
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('leitstelle_bypass_publish_blocked','admin_leitstelle_bypass_heal','package',
              v_pkg.package_id::text,'guard_blocked',
              jsonb_build_object('run_id',v_run_id,'error',v_err,'title',v_pkg.curriculum_title));
    END;
  END LOOP;

  -- ───── 2) Bulk-Requeue retriable failed jobs ─────
  IF NOT p_dry_run THEN
    WITH retriable AS (
      SELECT job_id FROM v_admin_queue_ssot
      WHERE health_signal='retriable' AND job_status='failed'
    )
    UPDATE job_queue jq
       SET status = 'queued',
           attempts = 0,
           last_error = NULL,
           last_error_code = NULL,
           locked_at = NULL,
           locked_by = NULL,
           started_at = NULL,
           run_after = now(),
           scheduled_at = now(),
           updated_at = now()
      FROM retriable r
     WHERE jq.id = r.job_id
       AND jq.status = 'failed';
    GET DIAGNOSTICS v_requeued = ROW_COUNT;

    IF v_requeued > 0 THEN
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('leitstelle_bulk_requeue_retriable','admin_leitstelle_bypass_heal','system',
              'job_queue','done',
              jsonb_build_object('run_id',v_run_id,'requeued_count',v_requeued));
    END IF;
  ELSE
    SELECT count(*) INTO v_requeued FROM v_admin_queue_ssot
      WHERE health_signal='retriable' AND job_status='failed';
  END IF;

  -- ───── 3) Stuck Packages: per-package nudge ─────
  FOR v_pkg IN
    SELECT package_id FROM v_admin_packages_ssot WHERE stuck_reason IS NOT NULL
  LOOP
    IF p_dry_run THEN
      v_stuck_nudged := v_stuck_nudged + 1;
      CONTINUE;
    END IF;
    BEGIN
      PERFORM admin_nudge_atomic_trigger(v_pkg.package_id, false);
      v_stuck_nudged := v_stuck_nudged + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('leitstelle_stuck_nudge_failed','admin_leitstelle_bypass_heal','package',
              v_pkg.package_id::text,'failed',
              jsonb_build_object('run_id',v_run_id,'error',SQLERRM));
    END;
  END LOOP;

  -- ───── Summary ─────
  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('leitstelle_bypass_heal_run','admin_leitstelle_bypass_heal','system','leitstelle','done',
          jsonb_build_object(
            'run_id',v_run_id,'dry_run',p_dry_run,
            'publish_published',v_pub_published,
            'publish_pricing_blocked',v_pub_pricing_blocked,
            'publish_guard_blocked',v_pub_guard_blocked,
            'requeued',v_requeued,
            'stuck_nudged',v_stuck_nudged
          ));

  RETURN jsonb_build_object(
    'run_id',v_run_id,'dry_run',p_dry_run,
    'publish',jsonb_build_object(
      'published',v_pub_published,
      'pricing_blocked',v_pub_pricing_blocked,
      'guard_blocked',v_pub_guard_blocked
    ),
    'requeued',v_requeued,
    'stuck_nudged',v_stuck_nudged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_leitstelle_bypass_heal(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_leitstelle_bypass_heal(boolean) TO service_role;

-- ---------- One-time live execution ----------------------------------
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.admin_leitstelle_bypass_heal(false);
  RAISE NOTICE 'leitstelle_bypass_heal result: %', v_result::text;
END$$;
