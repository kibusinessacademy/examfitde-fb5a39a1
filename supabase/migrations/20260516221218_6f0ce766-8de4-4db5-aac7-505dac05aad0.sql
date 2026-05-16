
-- ─────────────────────────────────────────────────────────────────────────────
-- Track 2.3d — Local Growth Repair Worker
-- Consumes v_growth_repair_eligibility_v1 (read-only).
-- Scope: local FANOUT_NOT_STARTED only. TRACKING_NOT_EMITTED is platform-fix
-- by construction (requires_platform_fix=true in the eligibility view) and is
-- therefore reported but never dispatched.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Classification helper (signal → class + scope)
CREATE OR REPLACE FUNCTION public.fn_growth_repair_class(_signal text)
RETURNS TABLE(class text, scope text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE _signal
      WHEN 'tracking_pricing_view'      THEN 'TRACKING_NOT_EMITTED'
      WHEN 'tracking_checkout_started'  THEN 'TRACKING_NOT_EMITTED'
      WHEN 'conversion_events'          THEN 'OBSERVABILITY_GAP'
      WHEN 'canonical_ok'               THEN 'SYSTEMIC_PLATFORM_DRIFT'
      WHEN 'seo_present'                THEN 'SEO_ARTIFACT_MISSING'
      WHEN 'no_dead_end'                THEN 'SEO_ARTIFACT_MISSING'
      WHEN 'blog'                       THEN 'FANOUT_NOT_STARTED'
      WHEN 'og_image'                   THEN 'FANOUT_NOT_STARTED'
      WHEN 'indexnow'                   THEN 'FANOUT_NOT_STARTED'
      WHEN 'internal_links'             THEN 'FANOUT_NOT_STARTED'
      WHEN 'campaign_assets'            THEN 'FANOUT_NOT_STARTED'
      WHEN 'distribution_targets'       THEN 'FANOUT_NOT_STARTED'
      ELSE 'UNCLASSIFIED'
    END AS class,
    CASE _signal
      WHEN 'tracking_pricing_view'      THEN 'platform'
      WHEN 'tracking_checkout_started'  THEN 'platform'
      WHEN 'conversion_events'          THEN 'platform'
      WHEN 'canonical_ok'               THEN 'platform'
      WHEN 'seo_present'                THEN 'local'
      WHEN 'no_dead_end'                THEN 'local'
      WHEN 'blog'                       THEN 'local'
      WHEN 'og_image'                   THEN 'local'
      WHEN 'indexnow'                   THEN 'local'
      WHEN 'internal_links'             THEN 'local'
      WHEN 'campaign_assets'            THEN 'local'
      WHEN 'distribution_targets'       THEN 'local'
      ELSE 'unknown'
    END AS scope;
$$;

REVOKE ALL ON FUNCTION public.fn_growth_repair_class(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_growth_repair_class(text) TO service_role;

-- 2) Local targets view (FANOUT_NOT_STARTED + TRACKING_NOT_EMITTED only)
CREATE OR REPLACE VIEW public.v_growth_repair_local_targets_v1 AS
SELECT
  e.package_id,
  e.package_key,
  e.package_title,
  e.track,
  e.signal,
  e.root_cause,
  e.repair_strategy,
  e.requires_platform_fix,
  e.expected_job_type,
  e.expected_artifact,
  e.active_job_id,
  e.blocked_reason,
  e.safe_to_repair,
  c.class,
  c.scope
FROM public.v_growth_repair_eligibility_v1 e
CROSS JOIN LATERAL public.fn_growth_repair_class(e.signal) c
WHERE c.class IN ('FANOUT_NOT_STARTED','TRACKING_NOT_EMITTED');

REVOKE ALL ON public.v_growth_repair_local_targets_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_growth_repair_local_targets_v1 TO service_role;

-- 3) Internal worker run (shared by admin and cron entrypoints)
--    Returns { mode, scanned, would_dispatch|dispatched, would_skip|skipped, failed, rows[], run_id }
CREATE OR REPLACE FUNCTION public._growth_local_worker_run(
  _mode text,          -- 'dry_run' | 'live'
  _limit int,
  _reason text,
  _actor uuid,
  _trigger_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_limit int := LEAST(GREATEST(COALESCE(_limit, 25), 1), 25);  -- HARD-CAP 25
  v_run_id uuid := gen_random_uuid();
  v_rows jsonb := '[]'::jsonb;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_decision jsonb;
  v_row record;
  v_new_job_id uuid;
  v_payload jsonb;
  v_skip_reason text;
  v_attempt jsonb;
BEGIN
  IF _mode NOT IN ('dry_run','live') THEN
    RAISE EXCEPTION 'invalid mode: %', _mode;
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.v_growth_repair_local_targets_v1
    WHERE scope = 'local'
      AND safe_to_repair = true
      AND expected_job_type IS NOT NULL
      AND class = 'FANOUT_NOT_STARTED'  -- TRACKING_NOT_EMITTED is platform-fix → never local-dispatchable
    ORDER BY package_id, signal
    LIMIT v_limit
  LOOP
    v_decision := public._growth_repair_decide(to_jsonb(v_row), v_now);

    IF v_decision->>'action' <> 'dispatch' THEN
      v_skipped := v_skipped + 1;
      v_skip_reason := COALESCE(v_decision->>'skip_reason','UNSPECIFIED');
      v_attempt := jsonb_build_object(
        'package_id', v_row.package_id,
        'signal', v_row.signal,
        'expected_job_type', v_row.expected_job_type,
        'class', v_row.class,
        'status', 'skipped',
        'skip_reason', v_skip_reason
      );
      v_rows := v_rows || jsonb_build_array(v_attempt);

      IF _mode = 'live' THEN
        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, metadata)
        VALUES
          ('growth_local_worker_attempt',
           v_row.package_id::text, 'course_package',
           _trigger_source,
           jsonb_build_object('signal', v_row.signal,
                              'expected_job_type', v_row.expected_job_type,
                              'class', v_row.class),
           'skipped',
           jsonb_build_object('run_id', v_run_id, 'skip_reason', v_skip_reason,
                              'actor', _actor, 'reason', _reason));
      END IF;
      CONTINUE;
    END IF;

    -- Dispatch path (live only — dry_run reports would_dispatch without insert)
    IF _mode = 'dry_run' THEN
      v_dispatched := v_dispatched + 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'package_id', v_row.package_id,
        'signal', v_row.signal,
        'expected_job_type', v_row.expected_job_type,
        'canonical_job_type', v_decision->>'canonical_job_type',
        'idempotency_key', v_decision->>'idempotency_key',
        'class', v_row.class,
        'status', 'would_dispatch'
      ));
      CONTINUE;
    END IF;

    -- LIVE dispatch
    v_payload := jsonb_build_object(
      'package_id',          v_row.package_id,
      'signal',              v_row.signal,
      'root_cause',          v_row.root_cause,
      'repair_strategy',     v_row.repair_strategy,
      'expected_job_type',   v_row.expected_job_type,
      'expected_artifact',   v_row.expected_artifact,
      '_origin',             'growth_local_worker_v1',
      '_dispatch_run_id',    v_run_id,
      '_dispatched_by',      _actor,
      '_reason',             _reason,
      '_trigger_source',     _trigger_source,
      '_class',              v_row.class
    );

    BEGIN
      INSERT INTO public.job_queue
        (job_type, status, payload, package_id, worker_pool,
         priority, idempotency_key, meta, job_name)
      VALUES
        (v_decision->>'canonical_job_type',
         'pending',
         v_payload,
         v_row.package_id,
         v_decision->>'worker_pool',
         (v_decision->>'priority')::int,
         v_decision->>'idempotency_key',
         jsonb_build_object(
           'dispatcher','growth_local_worker_v1',
           'signal', v_row.signal,
           'expected_job_type', v_row.expected_job_type,
           'class', v_row.class,
           'run_id', v_run_id
         ),
         'Growth Local: ' || v_row.signal || ' → ' || (v_decision->>'canonical_job_type'))
      RETURNING id INTO v_new_job_id;

      INSERT INTO public.growth_repair_dispatch_cooldown
        (package_id, signal, canonical_job_type, last_dispatched_at,
         last_idempotency_key, dispatches_count)
      VALUES
        (v_row.package_id, v_row.signal, v_decision->>'canonical_job_type',
         v_now, v_decision->>'idempotency_key', 1)
      ON CONFLICT (package_id, signal, canonical_job_type) DO UPDATE SET
        last_dispatched_at   = v_now,
        last_idempotency_key = EXCLUDED.last_idempotency_key,
        dispatches_count     = public.growth_repair_dispatch_cooldown.dispatches_count + 1;

      v_dispatched := v_dispatched + 1;
      v_attempt := jsonb_build_object(
        'package_id', v_row.package_id, 'signal', v_row.signal,
        'expected_job_type', v_row.expected_job_type,
        'canonical_job_type', v_decision->>'canonical_job_type',
        'job_id', v_new_job_id, 'idempotency_key', v_decision->>'idempotency_key',
        'class', v_row.class,
        'status', 'dispatched');
      v_rows := v_rows || jsonb_build_array(v_attempt);

      INSERT INTO public.auto_heal_log
        (action_type, target_id, target_type, trigger_source,
         input_params, result_status, metadata)
      VALUES
        ('growth_local_worker_attempt',
         v_row.package_id::text, 'course_package',
         _trigger_source,
         jsonb_build_object('signal', v_row.signal,
                            'expected_job_type', v_row.expected_job_type,
                            'class', v_row.class,
                            'reason', _reason),
         'dispatched',
         jsonb_build_object('run_id', v_run_id, 'job_id', v_new_job_id,
                            'idempotency_key', v_decision->>'idempotency_key',
                            'actor', _actor));

    EXCEPTION
      WHEN unique_violation THEN
        v_skipped := v_skipped + 1;
        v_attempt := jsonb_build_object(
          'package_id', v_row.package_id, 'signal', v_row.signal,
          'expected_job_type', v_row.expected_job_type,
          'class', v_row.class,
          'status', 'skipped', 'skip_reason', 'IDEMPOTENCY_CLASH');
        v_rows := v_rows || jsonb_build_array(v_attempt);
        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, metadata)
        VALUES
          ('growth_local_worker_attempt', v_row.package_id::text, 'course_package',
           _trigger_source,
           jsonb_build_object('signal', v_row.signal, 'class', v_row.class),
           'skipped',
           jsonb_build_object('run_id', v_run_id, 'skip_reason','IDEMPOTENCY_CLASH', 'actor', _actor));
      WHEN OTHERS THEN
        v_failed := v_failed + 1;
        v_attempt := jsonb_build_object(
          'package_id', v_row.package_id, 'signal', v_row.signal,
          'class', v_row.class,
          'status', 'failed', 'error', SQLERRM);
        v_rows := v_rows || jsonb_build_array(v_attempt);
        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, metadata)
        VALUES
          ('growth_local_worker_attempt', v_row.package_id::text, 'course_package',
           _trigger_source,
           jsonb_build_object('signal', v_row.signal, 'class', v_row.class),
           'failed',
           jsonb_build_object('run_id', v_run_id, 'error', SQLERRM, 'actor', _actor));
    END;
  END LOOP;

  -- Run summary audit (always, both modes)
  INSERT INTO public.auto_heal_log
    (action_type, target_id, target_type, trigger_source,
     input_params, result_status, metadata)
  VALUES
    ('growth_local_worker_run',
     v_run_id::text, 'system',
     _trigger_source,
     jsonb_build_object('mode', _mode, 'limit', v_limit, 'reason', _reason),
     CASE WHEN v_failed = 0 THEN 'ok' ELSE 'partial' END,
     jsonb_build_object(
       'run_id', v_run_id,
       'mode', _mode,
       'scanned', jsonb_array_length(v_rows),
       'dispatched', v_dispatched,
       'skipped', v_skipped,
       'failed', v_failed,
       'actor', _actor));

  RETURN jsonb_build_object(
    'mode', _mode,
    'run_id', v_run_id,
    'scanned', jsonb_array_length(v_rows),
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'failed', v_failed,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public._growth_local_worker_run(text,int,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._growth_local_worker_run(text,int,text,uuid,text) TO service_role;

-- 4) Admin entrypoints
CREATE OR REPLACE FUNCTION public.admin_growth_local_worker_dry_run(_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN public._growth_local_worker_run('dry_run', _limit, NULL, v_caller, 'admin_growth_local_worker_dry_run');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_growth_local_worker_live(_limit int DEFAULT 25, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'reason required (min 3 chars)';
  END IF;
  RETURN public._growth_local_worker_run('live', _limit, _reason, v_caller, 'admin_growth_local_worker_live');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_growth_local_worker_dry_run(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_growth_local_worker_live(int,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_growth_local_worker_dry_run(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_growth_local_worker_live(int,text) TO authenticated, service_role;

-- 5) Cron entrypoint (service_role / pg_cron only — no auth.uid check)
CREATE OR REPLACE FUNCTION public._growth_local_worker_cron_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin','service_role') THEN
    RAISE EXCEPTION 'forbidden: cron-only';
  END IF;
  RETURN public._growth_local_worker_run('live', 25, 'cron: 30min tick', NULL, '_growth_local_worker_cron_tick');
END;
$$;

REVOKE ALL ON FUNCTION public._growth_local_worker_cron_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._growth_local_worker_cron_tick() TO service_role;

-- 6) Summary RPC for UI
CREATE OR REPLACE FUNCTION public.admin_growth_local_worker_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_targets jsonb;
  v_recent jsonb;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'fanout_safe',     COUNT(*) FILTER (WHERE class='FANOUT_NOT_STARTED' AND safe_to_repair),
    'fanout_blocked',  COUNT(*) FILTER (WHERE class='FANOUT_NOT_STARTED' AND NOT safe_to_repair),
    'tracking_total',  COUNT(*) FILTER (WHERE class='TRACKING_NOT_EMITTED'),
    'by_signal',       (SELECT jsonb_object_agg(signal, n)
                        FROM (SELECT signal, COUNT(*) AS n
                              FROM public.v_growth_repair_local_targets_v1
                              WHERE class='FANOUT_NOT_STARTED' AND safe_to_repair
                              GROUP BY signal) s)
  )
  INTO v_targets
  FROM public.v_growth_repair_local_targets_v1;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT created_at, result_status, metadata
    FROM public.auto_heal_log
    WHERE action_type = 'growth_local_worker_run'
    ORDER BY created_at DESC
    LIMIT 10
  ) r;

  RETURN jsonb_build_object('targets', v_targets, 'recent_runs', v_recent);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_growth_local_worker_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_growth_local_worker_summary() TO authenticated, service_role;

-- 7) Cron schedule (every 30 minutes)
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'growth-local-worker-30min';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'growth-local-worker-30min',
    '*/30 * * * *',
    $cron$SELECT public._growth_local_worker_cron_tick();$cron$
  );
END$$;

-- 8) Init audit
INSERT INTO public.auto_heal_log
  (action_type, target_id, target_type, trigger_source, result_status, metadata)
VALUES
  ('track_2_3d_init', gen_random_uuid()::text, 'system',
   'migration:track_2_3d',
   'ok',
   jsonb_build_object(
     'cron','growth-local-worker-30min',
     'classes', jsonb_build_array('FANOUT_NOT_STARTED','TRACKING_NOT_EMITTED'),
     'dispatchable_classes', jsonb_build_array('FANOUT_NOT_STARTED'),
     'hard_limit', 25));
