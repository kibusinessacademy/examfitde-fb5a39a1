DO $$
DECLARE
  r record;
  v_council record;
  v_pkg record;
  v_score numeric; v_badge text; v_rules_failed int; v_attempts int;
  v_failed_rules jsonb; v_repair_vector jsonb; v_idem text;
  v_job_id uuid; v_active_job uuid;
  v_dispatched int := 0; v_terminal int := 0; v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT (metadata->>'bucket') AS bucket, target_id::uuid AS package_id
      FROM auto_heal_log
     WHERE trigger_source='migration:failed_cluster_24h_heal_2026_05_09'
       AND result_status='error'
       AND metadata->>'bucket'='A1_council_bronze'
  LOOP
    SELECT * INTO v_pkg FROM course_packages WHERE id=r.package_id FOR UPDATE;
    IF NOT FOUND OR v_pkg.curriculum_id IS NULL THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    SELECT * INTO v_council FROM package_steps
     WHERE package_id=r.package_id AND step_key='quality_council'
     ORDER BY updated_at DESC LIMIT 1;

    v_score := COALESCE((v_council.meta->>'score')::numeric,
                        (v_council.meta->'verdict'->>'score')::numeric);
    v_badge := COALESCE(v_council.meta->>'badge', v_council.meta->'verdict'->>'badge');
    v_rules_failed := COALESCE((v_council.meta->>'rules_failed')::int, 999);
    v_attempts := COALESCE((v_pkg.feature_flags->'bronze'->>'repair_attempts')::int, 0);

    IF v_badge IS DISTINCT FROM 'bronze' OR v_score IS NULL OR v_score < 75 OR v_rules_failed > 2 THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('migration:bucket_a1_inline_repair_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','warn','SKIP_NOT_BRONZE',
              jsonb_build_object('bucket','A1_inline_skip','badge',v_badge,'score',v_score,'rules_failed',v_rules_failed));
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    -- Already-active repair job?
    SELECT id INTO v_active_job FROM job_queue
     WHERE package_id=r.package_id
       AND job_type='package_elite_harden'
       AND status IN ('pending','processing')
       AND COALESCE(meta->>'bronze_repair','')='true'
     LIMIT 1;
    IF v_active_job IS NOT NULL THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('migration:bucket_a1_inline_repair_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','success','REPAIR_ALREADY_ACTIVE',
              jsonb_build_object('bucket','A1_inline_active','active_job',v_active_job));
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    -- Cap at 1 retry → mark requires_review terminal
    IF v_attempts >= 1 THEN
      UPDATE course_packages
         SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
               COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
                 'requires_review', true, 'final_state','requires_review',
                 'final_state_at', now(), 'last_score', v_score), true)
       WHERE id=r.package_id;
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('migration:bucket_a1_inline_repair_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','success','TERMINAL_REQUIRES_REVIEW',
              jsonb_build_object('bucket','A1_inline_terminal','attempts',v_attempts,'score',v_score));
      v_terminal := v_terminal + 1; CONTINUE;
    END IF;

    v_failed_rules := COALESCE(v_council.meta->'failed_rules','[]'::jsonb);
    v_repair_vector := COALESCE(v_council.meta->'repair_vector','{}'::jsonb);
    v_idem := 'bronze_repair:v3:'||r.package_id::text||':'||(v_attempts+1)::text;

    BEGIN
      INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
      VALUES ('package_elite_harden', r.package_id, 'pending', 7,
        jsonb_build_object(
          'package_id', r.package_id, 'curriculum_id', v_pkg.curriculum_id,
          '_origin','bronze_targeted_repair', 'mode','bronze_targeted_repair',
          'phase','bronze_repair', 'enqueue_source','bronze_targeted_repair',
          'bronze_lock_override', true,
          'failed_rules', v_failed_rules, 'repair_vector', v_repair_vector,
          'bronze_attempt', v_attempts+1, 'origin_council_score', v_score,
          'origin_council_rules_failed', v_rules_failed),
        jsonb_build_object('bronze_repair', true, 'attempt', v_attempts+1,
          'enqueue_source','bronze_targeted_repair', 'bronze_lock_override', true,
          'idem_version','v3'),
        v_idem)
      RETURNING id INTO v_job_id;

      UPDATE course_packages
         SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
               COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
                 'repair_active', true, 'repair_attempts', v_attempts+1,
                 'last_repair_at', now(), 'last_repair_job_id', v_job_id), true)
       WHERE id=r.package_id;

      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('migration:bucket_a1_inline_repair_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','success',
              format('bronze_repair_dispatched job=%s attempt=%s', v_job_id, v_attempts+1),
              jsonb_build_object('bucket','A1_inline_dispatched','job_id',v_job_id,'attempt',v_attempts+1,'score',v_score));
      v_dispatched := v_dispatched + 1;
    EXCEPTION WHEN unique_violation THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('migration:bucket_a1_inline_repair_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','warn','IDEM_KEY_CONFLICT',
              jsonb_build_object('bucket','A1_inline_skip','idem',v_idem));
      v_skipped := v_skipped + 1;
    WHEN OTHERS THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, error_message, metadata)
      VALUES ('migration:bucket_a1_inline_repair_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','error', SQLERRM,
              jsonb_build_object('bucket','A1_inline_error'));
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('migration:bucket_a1_inline_repair_2026_05_09','failed_cluster_24h_heal_summary',
          'system','system','success',
          format('dispatched=%s terminal=%s skipped=%s', v_dispatched, v_terminal, v_skipped),
          jsonb_build_object('dispatched',v_dispatched,'terminal',v_terminal,'skipped',v_skipped,'ran_at',now()));
END $$;