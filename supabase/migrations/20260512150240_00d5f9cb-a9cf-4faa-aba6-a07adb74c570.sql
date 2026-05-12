CREATE OR REPLACE FUNCTION public.admin_drain_bronze_review_required_v1(
  p_limit int DEFAULT 20,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid, title text, drain_class text,
  action_taken text, skip_reason text, job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_wip_cap          int := 15;
  v_active_integrity int;
  v_slot_remaining   int;
  v_pkg              record;
  v_curr_id          uuid;
  v_job_id           uuid;
  v_idem             text;
  v_recent_cooldown  boolean;
  v_n_quarantine     int := 0;
  v_n_recon          int := 0;
  v_n_skipped        int := 0;
  v_n_enqueued       int := 0;
  v_actor            text := COALESCE(auth.uid()::text, 'service_role');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND (current_setting('role', true) <> 'service_role'
          AND COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_LIMIT: p_limit must be 1..100';
  END IF;

  SELECT count(*) INTO v_active_integrity
    FROM job_queue
   WHERE job_type = 'package_run_integrity_check'
     AND status IN ('pending','processing');

  v_slot_remaining := GREATEST(v_wip_cap - v_active_integrity, 0);

  FOR v_pkg IN
    WITH gate AS (
      SELECT g.package_id AS pkg_id, g.score, g.hard_fail_count
        FROM v_publish_readiness_gate g
       WHERE g.gate_class = 'BRONZE_REVIEW_REQUIRED'
    ),
    quarantine_class AS (
      SELECT cp.id AS pkg_id, cp.title AS pkg_title, cp.curriculum_id,
             'QUARANTINE_STALE_REAP'::text AS d_class, 1 AS prio, cp.updated_at
        FROM course_packages cp
        JOIN gate g ON g.pkg_id = cp.id
       WHERE COALESCE((cp.feature_flags->'bronze_quarantine'->>'active')::boolean, false) = true
         AND cp.feature_flags->'bronze_quarantine'->>'reason' = 'STALE_REAP_LOOP_TERMINAL'
    ),
    reconciler_class AS (
      SELECT cp.id AS pkg_id, cp.title AS pkg_title, cp.curriculum_id,
             'RECONCILER_BRONZE_NO_REPORT'::text AS d_class, 2 AS prio, cp.updated_at
        FROM course_packages cp
        JOIN gate g ON g.pkg_id = cp.id
       WHERE cp.feature_flags->'bronze'->>'set_by' = 'reconciler_bronze_branch'
         AND cp.integrity_report IS NULL
         AND COALESCE((cp.feature_flags->'bronze_quarantine'->>'active')::boolean, false) = false
    )
    SELECT pkg_id, pkg_title, curriculum_id, d_class, prio, updated_at FROM quarantine_class
    UNION ALL
    SELECT pkg_id, pkg_title, curriculum_id, d_class, prio, updated_at FROM reconciler_class
    ORDER BY prio ASC, updated_at ASC
    LIMIT p_limit
  LOOP
    IF EXISTS (
      SELECT 1 FROM job_queue jq
       WHERE jq.package_id = v_pkg.pkg_id
         AND jq.job_type = 'package_run_integrity_check'
         AND jq.status IN ('pending','processing')
    ) THEN
      v_n_skipped := v_n_skipped + 1;
      package_id   := v_pkg.pkg_id; title := v_pkg.pkg_title;
      drain_class  := v_pkg.d_class; action_taken := 'skip';
      skip_reason  := 'active_integrity_job'; job_id := NULL;
      IF NOT p_dry_run THEN
        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
        VALUES ('bronze_review_drain_skipped','package', v_pkg.pkg_id::text, 'skipped',
                jsonb_build_object('drain_class', v_pkg.d_class, 'reason','active_integrity_job', 'actor', v_actor));
      END IF;
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM auto_heal_log
       WHERE target_id = v_pkg.pkg_id::text
         AND action_type IN ('bronze_review_drain_quarantine_release','bronze_review_drain_integrity_enqueued')
         AND created_at > now() - interval '5 minutes'
    ) INTO v_recent_cooldown;

    IF v_recent_cooldown THEN
      v_n_skipped := v_n_skipped + 1;
      package_id := v_pkg.pkg_id; title := v_pkg.pkg_title;
      drain_class := v_pkg.d_class; action_taken := 'skip';
      skip_reason := 'cooldown_5min'; job_id := NULL;
      IF NOT p_dry_run THEN
        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
        VALUES ('bronze_review_drain_skipped','package', v_pkg.pkg_id::text, 'skipped',
                jsonb_build_object('drain_class', v_pkg.d_class, 'reason','cooldown_5min', 'actor', v_actor));
      END IF;
      RETURN NEXT; CONTINUE;
    END IF;

    IF v_slot_remaining <= 0 THEN
      v_n_skipped := v_n_skipped + 1;
      package_id := v_pkg.pkg_id; title := v_pkg.pkg_title;
      drain_class := v_pkg.d_class; action_taken := 'skip';
      skip_reason := 'wip_cap_reached'; job_id := NULL;
      IF NOT p_dry_run THEN
        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
        VALUES ('bronze_review_drain_skipped','package', v_pkg.pkg_id::text, 'skipped',
                jsonb_build_object('drain_class', v_pkg.d_class, 'reason','wip_cap_reached',
                                   'wip_cap', v_wip_cap, 'active_integrity', v_active_integrity, 'actor', v_actor));
      END IF;
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := v_pkg.pkg_id; title := v_pkg.pkg_title;
      drain_class := v_pkg.d_class; action_taken := 'plan';
      skip_reason := NULL; job_id := NULL;
      RETURN NEXT;
      v_slot_remaining := v_slot_remaining - 1;
      CONTINUE;
    END IF;

    v_curr_id := v_pkg.curriculum_id;

    IF v_pkg.d_class = 'QUARANTINE_STALE_REAP' THEN
      UPDATE course_packages
         SET feature_flags = jsonb_set(
               COALESCE(feature_flags, '{}'::jsonb),
               '{bronze_quarantine}',
               COALESCE(feature_flags->'bronze_quarantine', '{}'::jsonb)
                 || jsonb_build_object('active', false, 'cleared_at', now(),
                       'cleared_by', v_actor, 'cleared_reason', 'bronze_review_drain_v1', 'manual_bypass', true),
               true)
       WHERE id = v_pkg.pkg_id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('bronze_review_drain_quarantine_release','package', v_pkg.pkg_id::text, 'success',
              jsonb_build_object('drain_class', v_pkg.d_class, 'actor', v_actor));

      v_n_quarantine := v_n_quarantine + 1;
    ELSE
      v_n_recon := v_n_recon + 1;
    END IF;

    v_idem := 'bronze_review_drain_v1:' || v_pkg.pkg_id::text
              || ':' || extract(epoch from date_trunc('minute', now()))::bigint::text;

    INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
    VALUES (
      'package_run_integrity_check', v_pkg.pkg_id, 'pending', 6,
      jsonb_build_object('package_id', v_pkg.pkg_id, 'curriculum_id', v_curr_id,
        'enqueue_source','bronze_targeted_repair', '_origin','bronze_review_drain_v1',
        'drain_class', v_pkg.d_class, 'bronze_lock_override', true),
      jsonb_build_object('enqueue_source','bronze_targeted_repair',
        'bronze_lock_override', true, 'drain_class', v_pkg.d_class, '_origin','bronze_review_drain_v1'),
      v_idem
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_job_id;

    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('bronze_review_drain_integrity_enqueued','package', v_pkg.pkg_id::text,
            CASE WHEN v_job_id IS NULL THEN 'noop' ELSE 'success' END,
            jsonb_build_object('drain_class', v_pkg.d_class, 'job_id', v_job_id,
              'idempotency_key', v_idem, 'actor', v_actor));

    v_n_enqueued     := v_n_enqueued + (CASE WHEN v_job_id IS NULL THEN 0 ELSE 1 END);
    v_slot_remaining := v_slot_remaining - 1;

    package_id := v_pkg.pkg_id; title := v_pkg.pkg_title;
    drain_class := v_pkg.d_class;
    action_taken := CASE WHEN v_job_id IS NULL THEN 'enqueued_noop_idem' ELSE 'enqueued' END;
    skip_reason := NULL; job_id := v_job_id;
    RETURN NEXT;
  END LOOP;

  IF NOT p_dry_run THEN
    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('bronze_review_drain_summary','system', NULL, 'success',
            jsonb_build_object('limit', p_limit, 'wip_cap', v_wip_cap,
              'active_integrity_at_start', v_active_integrity,
              'enqueued', v_n_enqueued, 'skipped', v_n_skipped,
              'class_quarantine_release', v_n_quarantine,
              'class_reconciler_bronze', v_n_recon, 'actor', v_actor));
  END IF;
END
$$;