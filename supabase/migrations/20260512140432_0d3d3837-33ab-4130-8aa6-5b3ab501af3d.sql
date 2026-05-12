-- admin_drain_bronze_review_required_v1
-- Sichere Bulk-Heal-RPC für 2 BRONZE_REVIEW_REQUIRED-Subklassen:
--   A) bronze_quarantine.active=true AND reason='STALE_REAP_LOOP_TERMINAL'
--   B) bronze.set_by='reconciler_bronze_branch' AND integrity_report IS NULL
-- Aktion: clear quarantine (A only) + enqueue package_run_integrity_check
--         mit payload.bronze_lock_override=true + enqueue_source='bronze_targeted_repair'

CREATE OR REPLACE FUNCTION public.admin_drain_bronze_review_required_v1(
  p_limit   int     DEFAULT 20,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE (
  package_id    uuid,
  title         text,
  drain_class   text,
  action_taken  text,
  skip_reason   text,
  job_id        uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
BEGIN
  -- AuthZ
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_LIMIT: p_limit must be 1..100';
  END IF;

  -- WIP-Cap berechnen
  SELECT count(*) INTO v_active_integrity
    FROM job_queue
   WHERE job_type = 'package_run_integrity_check'
     AND status IN ('pending','processing');

  v_slot_remaining := GREATEST(v_wip_cap - v_active_integrity, 0);

  -- Kandidaten-Pool: union der zwei sicheren Klassen
  FOR v_pkg IN
    WITH gate AS (
      SELECT package_id, score, hard_fail_count
        FROM v_publish_readiness_gate
       WHERE gate_class = 'BRONZE_REVIEW_REQUIRED'
    ),
    quarantine_class AS (
      SELECT cp.id AS package_id, cp.title, cp.curriculum_id,
             'QUARANTINE_STALE_REAP'::text AS drain_class,
             1 AS prio,
             cp.updated_at
        FROM course_packages cp
        JOIN gate g ON g.package_id = cp.id
       WHERE COALESCE((cp.feature_flags->'bronze_quarantine'->>'active')::boolean, false) = true
         AND cp.feature_flags->'bronze_quarantine'->>'reason' = 'STALE_REAP_LOOP_TERMINAL'
    ),
    reconciler_class AS (
      SELECT cp.id AS package_id, cp.title, cp.curriculum_id,
             'RECONCILER_BRONZE_NO_REPORT'::text AS drain_class,
             2 AS prio,
             cp.updated_at
        FROM course_packages cp
        JOIN gate g ON g.package_id = cp.id
       WHERE cp.feature_flags->'bronze'->>'set_by' = 'reconciler_bronze_branch'
         AND cp.integrity_report IS NULL
         AND COALESCE((cp.feature_flags->'bronze_quarantine'->>'active')::boolean, false) = false
    )
    SELECT * FROM quarantine_class
    UNION ALL
    SELECT * FROM reconciler_class
    ORDER BY prio ASC, updated_at ASC
    LIMIT p_limit
  LOOP
    -- Skip: aktiver integrity job?
    IF EXISTS (
      SELECT 1 FROM job_queue jq
       WHERE jq.package_id = v_pkg.package_id
         AND jq.job_type = 'package_run_integrity_check'
         AND jq.status IN ('pending','processing')
    ) THEN
      v_n_skipped := v_n_skipped + 1;
      package_id   := v_pkg.package_id;
      title        := v_pkg.title;
      drain_class  := v_pkg.drain_class;
      action_taken := 'skip';
      skip_reason  := 'active_integrity_job';
      job_id       := NULL;
      IF NOT p_dry_run THEN
        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_id)
        VALUES ('bronze_review_drain_skipped','package', v_pkg.package_id::text, 'skipped',
                jsonb_build_object('drain_class', v_pkg.drain_class, 'reason','active_integrity_job'),
                auth.uid());
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Skip: 5-min Package-Cooldown
    SELECT EXISTS (
      SELECT 1 FROM auto_heal_log
       WHERE target_id = v_pkg.package_id::text
         AND action_type IN (
           'bronze_review_drain_quarantine_release',
           'bronze_review_drain_integrity_enqueued')
         AND created_at > now() - interval '5 minutes'
    ) INTO v_recent_cooldown;

    IF v_recent_cooldown THEN
      v_n_skipped := v_n_skipped + 1;
      package_id   := v_pkg.package_id;
      title        := v_pkg.title;
      drain_class  := v_pkg.drain_class;
      action_taken := 'skip';
      skip_reason  := 'cooldown_5min';
      job_id       := NULL;
      IF NOT p_dry_run THEN
        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_id)
        VALUES ('bronze_review_drain_skipped','package', v_pkg.package_id::text, 'skipped',
                jsonb_build_object('drain_class', v_pkg.drain_class, 'reason','cooldown_5min'),
                auth.uid());
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Skip: WIP-Cap erreicht
    IF v_slot_remaining <= 0 THEN
      v_n_skipped := v_n_skipped + 1;
      package_id   := v_pkg.package_id;
      title        := v_pkg.title;
      drain_class  := v_pkg.drain_class;
      action_taken := 'skip';
      skip_reason  := 'wip_cap_reached';
      job_id       := NULL;
      IF NOT p_dry_run THEN
        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_id)
        VALUES ('bronze_review_drain_skipped','package', v_pkg.package_id::text, 'skipped',
                jsonb_build_object('drain_class', v_pkg.drain_class, 'reason','wip_cap_reached',
                                   'wip_cap', v_wip_cap, 'active_integrity', v_active_integrity),
                auth.uid());
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Dry-Run: nur Plan ausgeben
    IF p_dry_run THEN
      package_id   := v_pkg.package_id;
      title        := v_pkg.title;
      drain_class  := v_pkg.drain_class;
      action_taken := 'plan';
      skip_reason  := NULL;
      job_id       := NULL;
      RETURN NEXT;
      v_slot_remaining := v_slot_remaining - 1;
      CONTINUE;
    END IF;

    v_curr_id := v_pkg.curriculum_id;

    -- Aktion A: Quarantine-Release (nur QUARANTINE_STALE_REAP)
    IF v_pkg.drain_class = 'QUARANTINE_STALE_REAP' THEN
      UPDATE course_packages
         SET feature_flags = jsonb_set(
               COALESCE(feature_flags, '{}'::jsonb),
               '{bronze_quarantine}',
               COALESCE(feature_flags->'bronze_quarantine', '{}'::jsonb)
                 || jsonb_build_object(
                   'active', false,
                   'cleared_at', now(),
                   'cleared_by', COALESCE(auth.uid()::text,'service_role'),
                   'cleared_reason', 'bronze_review_drain_v1',
                   'manual_bypass', true),
               true)
       WHERE id = v_pkg.package_id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_id)
      VALUES ('bronze_review_drain_quarantine_release','package', v_pkg.package_id::text, 'success',
              jsonb_build_object('drain_class', v_pkg.drain_class), auth.uid());

      v_n_quarantine := v_n_quarantine + 1;
    ELSE
      v_n_recon := v_n_recon + 1;
    END IF;

    -- Aktion B: enqueue package_run_integrity_check mit bronze_lock_override
    v_idem := 'bronze_review_drain_v1:' || v_pkg.package_id::text
              || ':' || extract(epoch from date_trunc('minute', now()))::bigint::text;

    INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
    VALUES (
      'package_run_integrity_check',
      v_pkg.package_id,
      'pending',
      6,
      jsonb_build_object(
        'package_id', v_pkg.package_id,
        'curriculum_id', v_curr_id,
        'enqueue_source','bronze_targeted_repair',
        '_origin','bronze_review_drain_v1',
        'drain_class', v_pkg.drain_class,
        'bronze_lock_override', true
      ),
      jsonb_build_object(
        'enqueue_source','bronze_targeted_repair',
        'bronze_lock_override', true,
        'drain_class', v_pkg.drain_class,
        '_origin','bronze_review_drain_v1'),
      v_idem
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_job_id;

    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_id)
    VALUES ('bronze_review_drain_integrity_enqueued','package', v_pkg.package_id::text,
            CASE WHEN v_job_id IS NULL THEN 'noop' ELSE 'success' END,
            jsonb_build_object(
              'drain_class', v_pkg.drain_class,
              'job_id', v_job_id,
              'idempotency_key', v_idem),
            auth.uid());

    v_n_enqueued     := v_n_enqueued + (CASE WHEN v_job_id IS NULL THEN 0 ELSE 1 END);
    v_slot_remaining := v_slot_remaining - 1;

    package_id   := v_pkg.package_id;
    title        := v_pkg.title;
    drain_class  := v_pkg.drain_class;
    action_taken := CASE WHEN v_job_id IS NULL THEN 'enqueued_noop_idem' ELSE 'enqueued' END;
    skip_reason  := NULL;
    job_id       := v_job_id;
    RETURN NEXT;
  END LOOP;

  -- Summary-Audit (nur live)
  IF NOT p_dry_run THEN
    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_id)
    VALUES ('bronze_review_drain_summary','system', NULL, 'success',
            jsonb_build_object(
              'limit', p_limit,
              'wip_cap', v_wip_cap,
              'active_integrity_at_start', v_active_integrity,
              'enqueued', v_n_enqueued,
              'skipped', v_n_skipped,
              'class_quarantine_release', v_n_quarantine,
              'class_reconciler_bronze', v_n_recon),
            auth.uid());
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_drain_bronze_review_required_v1(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_drain_bronze_review_required_v1(int, boolean) TO service_role;

-- Smoke (Dry-Run, kein Side-Effect):
-- SELECT * FROM public.admin_drain_bronze_review_required_v1(10, true);

-- Rollback:
-- DROP FUNCTION IF EXISTS public.admin_drain_bronze_review_required_v1(int, boolean);