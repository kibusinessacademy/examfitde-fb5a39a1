
-- =====================================================================
-- Track 2.3c — Safe Growth Repair Dispatcher
-- =====================================================================

-- 1) Alias mapping: expected_job_type (from v_growth_repair_eligibility_v1)
--    → canonical registered job_type (ops_job_type_registry)
CREATE TABLE IF NOT EXISTS public.growth_repair_job_type_map (
  expected_job_type   text PRIMARY KEY,
  canonical_job_type  text NOT NULL,
  worker_pool         text NOT NULL DEFAULT 'core',
  priority            int  NOT NULL DEFAULT 50,
  cooldown_minutes    int  NOT NULL DEFAULT 60,
  is_active           bool NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.growth_repair_job_type_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.growth_repair_job_type_map;
CREATE POLICY "service_role_all"
  ON public.growth_repair_job_type_map
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.growth_repair_job_type_map
  (expected_job_type, canonical_job_type, worker_pool, priority, cooldown_minutes, notes)
VALUES
  ('seo_intent_page_generate',  'seo_intent_page_generate',  'core',      40, 60, '1:1 — registered'),
  ('seo_indexnow_submit',       'seo_indexnow_submit',       'core',      50, 60, '1:1 — registered'),
  ('seo_internal_link_seed',    'seo_internal_links',        'core',      55, 60, 'alias → seo_internal_links'),
  ('growth_blog_post_generate', 'package_post_publish_blog', 'marketing', 60, 60, 'alias → package_post_publish_blog'),
  ('growth_og_image_generate',  'package_og_image_generate', 'marketing', 60, 60, 'alias → package_og_image_generate')
ON CONFLICT (expected_job_type) DO UPDATE SET
  canonical_job_type = EXCLUDED.canonical_job_type,
  worker_pool        = EXCLUDED.worker_pool,
  priority           = EXCLUDED.priority,
  cooldown_minutes   = EXCLUDED.cooldown_minutes,
  notes              = EXCLUDED.notes,
  updated_at         = now();

-- 2) Cooldown table (per package × signal × canonical_job_type)
CREATE TABLE IF NOT EXISTS public.growth_repair_dispatch_cooldown (
  package_id         uuid NOT NULL,
  signal             text NOT NULL,
  canonical_job_type text NOT NULL,
  last_dispatched_at timestamptz NOT NULL DEFAULT now(),
  last_idempotency_key text,
  dispatches_count   int NOT NULL DEFAULT 1,
  PRIMARY KEY (package_id, signal, canonical_job_type)
);

ALTER TABLE public.growth_repair_dispatch_cooldown ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.growth_repair_dispatch_cooldown;
CREATE POLICY "service_role_all"
  ON public.growth_repair_dispatch_cooldown
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_growth_repair_cooldown_last_dispatched
  ON public.growth_repair_dispatch_cooldown (last_dispatched_at DESC);

-- 3) Internal helper: evaluate one eligibility row → decision JSON
-- Returns: { action: 'dispatch' | 'skip', skip_reason?, canonical_job_type?, idempotency_key?, worker_pool?, priority? }
CREATE OR REPLACE FUNCTION public._growth_repair_decide(
  _row jsonb,
  _now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg              uuid := (_row->>'package_id')::uuid;
  v_signal           text := _row->>'signal';
  v_expected         text := _row->>'expected_job_type';
  v_safe             bool := COALESCE((_row->>'safe_to_repair')::bool, false);
  v_platform_fix     bool := COALESCE((_row->>'requires_platform_fix')::bool, false);
  v_blocked          text := _row->>'blocked_reason';
  v_active_job       uuid := NULLIF(_row->>'active_job_id','')::uuid;
  v_map              public.growth_repair_job_type_map%ROWTYPE;
  v_idem             text;
  v_last_dispatched  timestamptz;
  v_cooldown_min     int;
  v_existing_active  uuid;
BEGIN
  -- Hard guards (defense in depth — view already encodes these)
  IF v_platform_fix THEN
    RETURN jsonb_build_object('action','skip','skip_reason','REQUIRES_PLATFORM_FIX');
  END IF;
  IF v_blocked IS NOT NULL THEN
    RETURN jsonb_build_object('action','skip','skip_reason', v_blocked);
  END IF;
  IF NOT v_safe THEN
    RETURN jsonb_build_object('action','skip','skip_reason','NOT_SAFE_TO_REPAIR');
  END IF;
  IF v_active_job IS NOT NULL THEN
    RETURN jsonb_build_object('action','skip','skip_reason','ACTIVE_JOB_PRESENT');
  END IF;
  IF v_expected IS NULL OR v_expected = '' THEN
    RETURN jsonb_build_object('action','skip','skip_reason','NO_EXPECTED_JOB_TYPE');
  END IF;

  -- Mapping (must be active and registered)
  SELECT * INTO v_map
  FROM public.growth_repair_job_type_map
  WHERE expected_job_type = v_expected AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action','skip','skip_reason','UNMAPPED_JOB_TYPE',
                              'expected_job_type', v_expected);
  END IF;

  -- Canonical must exist in registry & be active
  IF NOT EXISTS (
    SELECT 1 FROM public.ops_job_type_registry
    WHERE job_type = v_map.canonical_job_type AND is_active
  ) THEN
    RETURN jsonb_build_object('action','skip','skip_reason','UNREGISTERED_JOB_TYPE',
                              'canonical_job_type', v_map.canonical_job_type);
  END IF;

  -- Second active-job check on the CANONICAL job_type (the view checks on expected)
  SELECT id INTO v_existing_active
  FROM public.job_queue
  WHERE package_id = v_pkg
    AND job_type   = v_map.canonical_job_type
    AND status IN ('pending','processing','queued')
  LIMIT 1;
  IF v_existing_active IS NOT NULL THEN
    RETURN jsonb_build_object('action','skip','skip_reason','ACTIVE_JOB_PRESENT_CANONICAL',
                              'active_job_id', v_existing_active);
  END IF;

  -- Cooldown
  v_cooldown_min := COALESCE(v_map.cooldown_minutes, 60);
  SELECT last_dispatched_at INTO v_last_dispatched
  FROM public.growth_repair_dispatch_cooldown
  WHERE package_id = v_pkg
    AND signal = v_signal
    AND canonical_job_type = v_map.canonical_job_type;
  IF v_last_dispatched IS NOT NULL
     AND v_last_dispatched > (_now - make_interval(mins => v_cooldown_min)) THEN
    RETURN jsonb_build_object(
      'action','skip','skip_reason','COOLDOWN_ACTIVE',
      'cooldown_until', (v_last_dispatched + make_interval(mins => v_cooldown_min))
    );
  END IF;

  -- Hourly idempotency key (spec format)
  v_idem := 'growth_repair:'
         || v_pkg::text || ':'
         || v_signal || ':'
         || v_expected || ':'
         || to_char(_now AT TIME ZONE 'UTC','YYYYMMDDHH24');

  RETURN jsonb_build_object(
    'action','dispatch',
    'canonical_job_type', v_map.canonical_job_type,
    'idempotency_key',    v_idem,
    'worker_pool',        v_map.worker_pool,
    'priority',           v_map.priority,
    'cooldown_minutes',   v_cooldown_min
  );
END;
$$;

REVOKE ALL ON FUNCTION public._growth_repair_decide(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._growth_repair_decide(jsonb, timestamptz) TO service_role;

-- 4) Dry-run RPC (admin gated)
CREATE OR REPLACE FUNCTION public.admin_growth_repair_dispatch_dry_run(
  _limit int DEFAULT 25,
  _strategy text DEFAULT NULL,
  _root_cause text DEFAULT NULL,
  _track text DEFAULT NULL,
  _package_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_now timestamptz := now();
  v_limit int := LEAST(GREATEST(COALESCE(_limit,25), 1), 200);
  v_rows jsonb := '[]'::jsonb;
  v_dispatch int := 0;
  v_skip int := 0;
  v_decision jsonb;
  v_row record;
  v_result_row jsonb;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.v_growth_repair_eligibility_v1 e
    WHERE e.safe_to_repair = true
      AND e.expected_job_type IS NOT NULL
      AND (_strategy   IS NULL OR e.repair_strategy = _strategy)
      AND (_root_cause IS NULL OR e.root_cause = _root_cause)
      AND (_track      IS NULL OR e.track = _track)
      AND (_package_id IS NULL OR e.package_id = _package_id)
    ORDER BY e.package_id, e.signal
    LIMIT v_limit
  LOOP
    v_decision := public._growth_repair_decide(to_jsonb(v_row), v_now);
    v_result_row := jsonb_build_object(
      'package_id',        v_row.package_id,
      'package_key',       v_row.package_key,
      'signal',            v_row.signal,
      'expected_job_type', v_row.expected_job_type,
      'decision',          v_decision
    );
    v_rows := v_rows || jsonb_build_array(v_result_row);
    IF v_decision->>'action' = 'dispatch' THEN
      v_dispatch := v_dispatch + 1;
    ELSE
      v_skip := v_skip + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'mode','dry_run',
    'scanned',     v_dispatch + v_skip,
    'would_dispatch', v_dispatch,
    'would_skip',     v_skip,
    'limit',          v_limit,
    'generated_at',   v_now,
    'rows',           v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_growth_repair_dispatch_dry_run(int,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_repair_dispatch_dry_run(int,text,text,text,uuid) TO authenticated, service_role;

-- 5) Live dispatch RPC (admin gated, batch_limit default 25)
CREATE OR REPLACE FUNCTION public.admin_growth_repair_dispatch_live(
  _limit int DEFAULT 25,
  _strategy text DEFAULT NULL,
  _root_cause text DEFAULT NULL,
  _track text DEFAULT NULL,
  _package_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_now timestamptz := now();
  v_limit int := LEAST(GREATEST(COALESCE(_limit,25), 1), 100);
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
  v_attempt_log jsonb;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.v_growth_repair_eligibility_v1 e
    WHERE e.safe_to_repair = true
      AND e.expected_job_type IS NOT NULL
      AND (_strategy   IS NULL OR e.repair_strategy = _strategy)
      AND (_root_cause IS NULL OR e.root_cause = _root_cause)
      AND (_track      IS NULL OR e.track = _track)
      AND (_package_id IS NULL OR e.package_id = _package_id)
    ORDER BY e.package_id, e.signal
    LIMIT v_limit
  LOOP
    v_decision := public._growth_repair_decide(to_jsonb(v_row), v_now);

    IF v_decision->>'action' = 'dispatch' THEN
      v_payload := jsonb_build_object(
        'package_id',          v_row.package_id,
        'signal',              v_row.signal,
        'root_cause',          v_row.root_cause,
        'repair_strategy',     v_row.repair_strategy,
        'expected_job_type',   v_row.expected_job_type,
        'expected_artifact',   v_row.expected_artifact,
        '_origin',             'growth_repair_dispatcher_v1',
        '_dispatch_run_id',    v_run_id,
        '_dispatched_by',      v_caller,
        '_reason',             _reason
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
             'dispatcher','growth_repair_v1',
             'signal', v_row.signal,
             'expected_job_type', v_row.expected_job_type,
             'run_id', v_run_id
           ),
           'Growth Repair: ' || v_row.signal || ' → ' || (v_decision->>'canonical_job_type')
          )
        RETURNING id INTO v_new_job_id;

        -- Update cooldown
        INSERT INTO public.growth_repair_dispatch_cooldown
          (package_id, signal, canonical_job_type, last_dispatched_at,
           last_idempotency_key, dispatches_count)
        VALUES
          (v_row.package_id, v_row.signal, v_decision->>'canonical_job_type',
           v_now, v_decision->>'idempotency_key', 1)
        ON CONFLICT (package_id, signal, canonical_job_type) DO UPDATE SET
          last_dispatched_at  = v_now,
          last_idempotency_key= EXCLUDED.last_idempotency_key,
          dispatches_count    = public.growth_repair_dispatch_cooldown.dispatches_count + 1;

        v_dispatched := v_dispatched + 1;
        v_attempt_log := jsonb_build_object(
          'package_id', v_row.package_id, 'signal', v_row.signal,
          'expected_job_type', v_row.expected_job_type,
          'canonical_job_type', v_decision->>'canonical_job_type',
          'job_id', v_new_job_id, 'idempotency_key', v_decision->>'idempotency_key',
          'status','dispatched'
        );

        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, metadata)
        VALUES
          ('growth_repair_dispatch_attempt',
           v_row.package_id::text, 'course_package',
           'admin_growth_repair_dispatch_live',
           jsonb_build_object('signal', v_row.signal,
                              'expected_job_type', v_row.expected_job_type,
                              'reason', _reason),
           'dispatched',
           v_attempt_log || jsonb_build_object('run_id', v_run_id, 'actor', v_caller));

      EXCEPTION WHEN unique_violation THEN
        -- Idempotency clash → another dispatch in the same hour
        v_skipped := v_skipped + 1;
        v_attempt_log := jsonb_build_object(
          'package_id', v_row.package_id, 'signal', v_row.signal,
          'expected_job_type', v_row.expected_job_type,
          'canonical_job_type', v_decision->>'canonical_job_type',
          'idempotency_key', v_decision->>'idempotency_key',
          'status','skipped','skip_reason','IDEMPOTENCY_CLASH'
        );
        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, metadata)
        VALUES
          ('growth_repair_dispatch_attempt',
           v_row.package_id::text, 'course_package',
           'admin_growth_repair_dispatch_live',
           jsonb_build_object('signal', v_row.signal),
           'skipped',
           v_attempt_log || jsonb_build_object('run_id', v_run_id, 'actor', v_caller));
      WHEN OTHERS THEN
        v_failed := v_failed + 1;
        v_attempt_log := jsonb_build_object(
          'package_id', v_row.package_id, 'signal', v_row.signal,
          'expected_job_type', v_row.expected_job_type,
          'status','failed','error', SQLERRM, 'sqlstate', SQLSTATE
        );
        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, error_message, metadata)
        VALUES
          ('growth_repair_dispatch_attempt',
           v_row.package_id::text, 'course_package',
           'admin_growth_repair_dispatch_live',
           jsonb_build_object('signal', v_row.signal),
           'failed', SQLERRM,
           v_attempt_log || jsonb_build_object('run_id', v_run_id, 'actor', v_caller));
      END;
    ELSE
      v_skipped := v_skipped + 1;
      v_skip_reason := v_decision->>'skip_reason';
      v_attempt_log := jsonb_build_object(
        'package_id', v_row.package_id, 'signal', v_row.signal,
        'expected_job_type', v_row.expected_job_type,
        'status','skipped','skip_reason', v_skip_reason,
        'decision', v_decision
      );
      INSERT INTO public.auto_heal_log
        (action_type, target_id, target_type, trigger_source,
         input_params, result_status, metadata)
      VALUES
        ('growth_repair_dispatch_attempt',
         v_row.package_id::text, 'course_package',
         'admin_growth_repair_dispatch_live',
         jsonb_build_object('signal', v_row.signal, 'skip_reason', v_skip_reason),
         'skipped',
         v_attempt_log || jsonb_build_object('run_id', v_run_id, 'actor', v_caller));
    END IF;

    v_rows := v_rows || jsonb_build_array(v_attempt_log);
  END LOOP;

  -- Summary audit row
  INSERT INTO public.auto_heal_log
    (action_type, target_id, target_type, trigger_source,
     input_params, result_status, metadata)
  VALUES
    ('growth_repair_dispatch_run',
     v_run_id::text, 'system',
     'admin_growth_repair_dispatch_live',
     jsonb_build_object(
       'limit', v_limit, 'strategy', _strategy, 'root_cause', _root_cause,
       'track', _track, 'package_id', _package_id, 'reason', _reason
     ),
     CASE WHEN v_failed > 0 THEN 'partial' ELSE 'ok' END,
     jsonb_build_object(
       'run_id', v_run_id, 'actor', v_caller,
       'dispatched', v_dispatched, 'skipped', v_skipped, 'failed', v_failed,
       'scanned', v_dispatched + v_skipped + v_failed
     ));

  RETURN jsonb_build_object(
    'mode','live',
    'run_id', v_run_id,
    'scanned', v_dispatched + v_skipped + v_failed,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'failed', v_failed,
    'limit', v_limit,
    'generated_at', v_now,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_growth_repair_dispatch_live(int,text,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_repair_dispatch_live(int,text,text,text,uuid,text) TO authenticated, service_role;

-- 6) Recent run history RPC (for UI)
CREATE OR REPLACE FUNCTION public.admin_growth_repair_recent_runs(_limit int DEFAULT 20)
RETURNS TABLE (
  run_id uuid,
  created_at timestamptz,
  result_status text,
  dispatched int,
  skipped int,
  failed int,
  scanned int,
  actor uuid,
  reason text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (metadata->>'run_id')::uuid,
    created_at,
    result_status,
    COALESCE((metadata->>'dispatched')::int, 0),
    COALESCE((metadata->>'skipped')::int, 0),
    COALESCE((metadata->>'failed')::int, 0),
    COALESCE((metadata->>'scanned')::int, 0),
    NULLIF(metadata->>'actor','')::uuid,
    input_params->>'reason'
  FROM public.auto_heal_log
  WHERE action_type = 'growth_repair_dispatch_run'
    AND has_role(auth.uid(),'admin'::app_role)
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

REVOKE ALL ON FUNCTION public.admin_growth_repair_recent_runs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_repair_recent_runs(int) TO authenticated, service_role;

-- 7) Init audit
INSERT INTO public.auto_heal_log
  (action_type, target_id, target_type, trigger_source, result_status, metadata)
VALUES
  ('track_2_3c_init', NULL, 'system', 'migration',
   'ok',
   jsonb_build_object(
     'version','v1',
     'description','Safe Growth Repair Dispatcher (dry-run + live + cooldown + idem)',
     'mappings', 5,
     'baseline_safe_signals', (SELECT COUNT(*) FROM public.v_growth_repair_eligibility_v1
                               WHERE safe_to_repair AND expected_job_type IS NOT NULL)
   ));
