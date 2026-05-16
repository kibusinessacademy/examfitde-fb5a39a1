
-- ============================================================
-- Track 2.3f — Outcome-based Repair Governance
-- ============================================================

-- 1) Strategy state table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.growth_repair_strategy_state (
  signal text NOT NULL,
  canonical_job_type text NOT NULL,
  governance_state text NOT NULL DEFAULT 'active',
    -- 'active' | 'downranked' | 'blocked'
  recommendation text,
    -- 'trust' | 'observe' | 'tune' | 'downrank' | 'block'
  trust_score numeric,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_override boolean NOT NULL DEFAULT false,
  override_reason text,
  override_by uuid,
  last_recomputed_at timestamptz,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal, canonical_job_type),
  CONSTRAINT growth_repair_strategy_state_state_chk
    CHECK (governance_state IN ('active','downranked','blocked'))
);

ALTER TABLE public.growth_repair_strategy_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_growth_repair_strategy_state"
  ON public.growth_repair_strategy_state;
CREATE POLICY "service_role_growth_repair_strategy_state"
  ON public.growth_repair_strategy_state
  TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.growth_repair_strategy_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.growth_repair_strategy_state TO service_role;

-- 2) Health view (read by RPC) ------------------------------------------------
CREATE OR REPLACE VIEW public.v_growth_repair_strategy_health_v1 AS
WITH base AS (
  SELECT o.signal,
         o.expected_job_type,
         COALESCE(o.canonical_job_type,
                  m.canonical_job_type,
                  o.expected_job_type) AS canonical_job_type,
         o.outcome,
         o.dispatched_at,
         o.verified_at,
         o.verification_attempts
    FROM public.growth_repair_outcomes o
    LEFT JOIN public.growth_repair_job_type_map m
      ON m.expected_job_type = o.expected_job_type
   WHERE o.dispatched_at > now() - interval '14 days'
),
agg AS (
  SELECT signal, canonical_job_type,
         COUNT(*)                                                AS total,
         COUNT(*) FILTER (WHERE outcome='pending')               AS pending,
         COUNT(*) FILTER (WHERE outcome='signal_closed')         AS closed,
         COUNT(*) FILTER (WHERE outcome='job_failed')            AS failed,
         COUNT(*) FILTER (WHERE outcome='stale')                 AS stale,
         COUNT(*) FILTER (WHERE outcome='abandoned')             AS abandoned,
         COUNT(*) FILTER (WHERE outcome <> 'pending')            AS verified,
         AVG(EXTRACT(EPOCH FROM (verified_at - dispatched_at))/60.0)
           FILTER (WHERE outcome='signal_closed')                AS avg_close_minutes
    FROM base
   GROUP BY signal, canonical_job_type
)
SELECT a.signal,
       a.canonical_job_type,
       a.total, a.pending, a.closed, a.failed, a.stale, a.abandoned, a.verified,
       CASE WHEN a.verified > 0
            THEN ROUND(a.closed   * 100.0 / a.verified, 1) ELSE NULL END AS close_rate_pct,
       CASE WHEN a.verified > 0
            THEN ROUND(a.failed   * 100.0 / a.verified, 1) ELSE NULL END AS fail_rate_pct,
       CASE WHEN a.verified > 0
            THEN ROUND(a.stale    * 100.0 / a.verified, 1) ELSE NULL END AS stale_rate_pct,
       CASE WHEN a.verified > 0
            THEN ROUND(a.abandoned* 100.0 / a.verified, 1) ELSE NULL END AS abandoned_rate_pct,
       ROUND(a.avg_close_minutes::numeric, 1) AS avg_close_minutes,
       -- Trust score 0..100: rewards closes, penalises fail+abandoned, light penalty for stale
       CASE WHEN a.verified > 0 THEN
         GREATEST(0, LEAST(100,
           ROUND(
             (a.closed * 100.0
              - a.failed * 80.0
              - a.abandoned * 90.0
              - a.stale * 30.0
             ) / a.verified
           )
         ))
       ELSE NULL END AS trust_score
  FROM agg a;

REVOKE ALL ON public.v_growth_repair_strategy_health_v1 FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_growth_repair_strategy_health_v1 TO service_role;

-- 3) Recompute governance -----------------------------------------------------
CREATE OR REPLACE FUNCTION public._growth_repair_recompute_strategy_governance(
  _reason text DEFAULT NULL,
  _actor  uuid DEFAULT NULL,
  _trigger_source text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_row record;
  v_old record;
  v_new_state text;
  v_recommendation text;
  v_n_seen int := 0;
  v_n_changed int := 0;
  v_n_blocked int := 0;
  v_n_downranked int := 0;
  v_n_active int := 0;
  v_n_skipped_manual int := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_growth_repair_strategy_health_v1
  LOOP
    v_n_seen := v_n_seen + 1;

    -- Decide recommendation (deterministic ladder; tie-break by precedence below)
    IF v_row.verified >= 5 AND v_row.fail_rate_pct >= 60 THEN
      v_recommendation := 'block';
    ELSIF v_row.verified >= 5 AND v_row.abandoned_rate_pct >= 50 THEN
      v_recommendation := 'block';
    ELSIF v_row.verified >= 5 AND v_row.close_rate_pct < 30 THEN
      v_recommendation := 'downrank';
    ELSIF v_row.verified >= 5 AND v_row.stale_rate_pct >= 50 THEN
      v_recommendation := 'tune';
    ELSIF v_row.verified >= 10 AND v_row.close_rate_pct >= 80 THEN
      v_recommendation := 'trust';
    ELSE
      v_recommendation := 'observe';
    END IF;

    v_new_state := CASE v_recommendation
      WHEN 'block'     THEN 'blocked'
      WHEN 'downrank'  THEN 'downranked'
      ELSE 'active'
    END;

    -- Existing row
    SELECT * INTO v_old
      FROM public.growth_repair_strategy_state
     WHERE signal = v_row.signal
       AND canonical_job_type = v_row.canonical_job_type;

    IF FOUND AND v_old.manual_override THEN
      -- Preserve manual state; refresh metrics + recommendation only.
      UPDATE public.growth_repair_strategy_state
         SET trust_score = v_row.trust_score,
             recommendation = v_recommendation,
             metrics = to_jsonb(v_row),
             last_recomputed_at = now(),
             updated_at = now()
       WHERE signal = v_row.signal
         AND canonical_job_type = v_row.canonical_job_type;
      v_n_skipped_manual := v_n_skipped_manual + 1;
    ELSE
      INSERT INTO public.growth_repair_strategy_state
        (signal, canonical_job_type, governance_state, recommendation,
         trust_score, metrics, last_recomputed_at, state_changed_at)
      VALUES
        (v_row.signal, v_row.canonical_job_type, v_new_state, v_recommendation,
         v_row.trust_score, to_jsonb(v_row), now(), now())
      ON CONFLICT (signal, canonical_job_type) DO UPDATE
        SET governance_state = EXCLUDED.governance_state,
            recommendation   = EXCLUDED.recommendation,
            trust_score      = EXCLUDED.trust_score,
            metrics          = EXCLUDED.metrics,
            last_recomputed_at = now(),
            state_changed_at = CASE
              WHEN public.growth_repair_strategy_state.governance_state
                <> EXCLUDED.governance_state
              THEN now()
              ELSE public.growth_repair_strategy_state.state_changed_at
            END,
            updated_at = now();

      -- Did state change?
      IF v_old IS NULL OR v_old.governance_state IS DISTINCT FROM v_new_state THEN
        v_n_changed := v_n_changed + 1;
        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, metadata)
        VALUES
          ('growth_repair_strategy_state_changed',
           v_row.signal || '|' || v_row.canonical_job_type,
           'growth_repair_strategy',
           _trigger_source,
           jsonb_build_object('signal', v_row.signal,
                              'canonical_job_type', v_row.canonical_job_type,
                              'reason', _reason),
           'changed',
           jsonb_build_object(
             'run_id', v_run_id,
             'old_state', COALESCE(v_old.governance_state, 'none'),
             'new_state', v_new_state,
             'recommendation', v_recommendation,
             'trust_score', v_row.trust_score,
             'metrics', to_jsonb(v_row),
             'actor', _actor));
      END IF;
    END IF;

    IF v_new_state = 'blocked'     THEN v_n_blocked     := v_n_blocked + 1;     END IF;
    IF v_new_state = 'downranked'  THEN v_n_downranked  := v_n_downranked + 1;  END IF;
    IF v_new_state = 'active'      THEN v_n_active      := v_n_active + 1;      END IF;
  END LOOP;

  -- Run summary
  INSERT INTO public.auto_heal_log
    (action_type, target_id, target_type, trigger_source,
     input_params, result_status, metadata)
  VALUES
    ('growth_repair_governance_recompute',
     v_run_id::text, 'system',
     _trigger_source,
     jsonb_build_object('reason', _reason),
     'ok',
     jsonb_build_object(
       'run_id', v_run_id,
       'seen', v_n_seen,
       'changed', v_n_changed,
       'blocked', v_n_blocked,
       'downranked', v_n_downranked,
       'active', v_n_active,
       'skipped_manual', v_n_skipped_manual,
       'actor', _actor));

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'seen', v_n_seen,
    'changed', v_n_changed,
    'blocked', v_n_blocked,
    'downranked', v_n_downranked,
    'active', v_n_active,
    'skipped_manual', v_n_skipped_manual);
END;
$fn$;

REVOKE ALL ON FUNCTION public._growth_repair_recompute_strategy_governance(text,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._growth_repair_recompute_strategy_governance(text,uuid,text)
  TO service_role;

-- 4) Extend dispatch decision with governance gate ----------------------------
CREATE OR REPLACE FUNCTION public._growth_repair_decide(
  _row jsonb,
  _now timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
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
  v_gov              record;
  v_governance_state text;
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

  -- Track 2.3f governance gate ------------------------------------------------
  SELECT governance_state, recommendation, trust_score
    INTO v_gov
    FROM public.growth_repair_strategy_state
   WHERE signal = v_signal
     AND canonical_job_type = v_map.canonical_job_type;
  v_governance_state := COALESCE(v_gov.governance_state, 'active');

  IF v_governance_state = 'blocked' THEN
    RETURN jsonb_build_object(
      'action','skip','skip_reason','GOVERNANCE_BLOCKED',
      'recommendation', v_gov.recommendation,
      'trust_score', v_gov.trust_score
    );
  END IF;

  -- Second active-job check on the CANONICAL job_type
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

  -- Cooldown (downranked strategies: doubled cooldown)
  v_cooldown_min := COALESCE(v_map.cooldown_minutes, 60);
  IF v_governance_state = 'downranked' THEN
    v_cooldown_min := v_cooldown_min * 2;
  END IF;
  SELECT last_dispatched_at INTO v_last_dispatched
  FROM public.growth_repair_dispatch_cooldown
  WHERE package_id = v_pkg
    AND signal = v_signal
    AND canonical_job_type = v_map.canonical_job_type;
  IF v_last_dispatched IS NOT NULL
     AND v_last_dispatched > (_now - make_interval(mins => v_cooldown_min)) THEN
    RETURN jsonb_build_object(
      'action','skip','skip_reason','COOLDOWN_ACTIVE',
      'cooldown_until', (v_last_dispatched + make_interval(mins => v_cooldown_min)),
      'governance_state', v_governance_state
    );
  END IF;

  -- Hourly idempotency key
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
    'cooldown_minutes',   v_cooldown_min,
    'governance_state',   v_governance_state
  );
END;
$fn$;

-- 5) Admin RPCs ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_growth_repair_strategy_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH joined AS (
    SELECT h.*,
           COALESCE(s.governance_state, 'active') AS governance_state,
           s.recommendation AS persisted_recommendation,
           s.manual_override,
           s.override_reason,
           s.last_recomputed_at,
           s.state_changed_at
      FROM public.v_growth_repair_strategy_health_v1 h
      LEFT JOIN public.growth_repair_strategy_state s
        ON s.signal = h.signal AND s.canonical_job_type = h.canonical_job_type
  ),
  totals AS (
    SELECT COUNT(*)                                              AS strategies,
           COUNT(*) FILTER (WHERE governance_state='blocked')    AS blocked,
           COUNT(*) FILTER (WHERE governance_state='downranked') AS downranked,
           COUNT(*) FILTER (WHERE governance_state='active')     AS active,
           COUNT(*) FILTER (WHERE manual_override)               AS manual,
           SUM(total) AS total_outcomes,
           SUM(closed) AS total_closed,
           SUM(failed) AS total_failed
      FROM joined
  ),
  recent AS (
    SELECT created_at, result_status, metadata
      FROM public.auto_heal_log
     WHERE action_type IN ('growth_repair_governance_recompute',
                           'growth_repair_strategy_state_changed')
     ORDER BY created_at DESC
     LIMIT 15
  )
  SELECT jsonb_build_object(
    'window_days', 14,
    'totals', (SELECT to_jsonb(totals) FROM totals),
    'strategies',
      COALESCE((SELECT jsonb_agg(to_jsonb(joined)
                       ORDER BY (governance_state='blocked') DESC,
                                (governance_state='downranked') DESC,
                                total DESC) FROM joined), '[]'::jsonb),
    'recent_events',
      COALESCE((SELECT jsonb_agg(to_jsonb(recent) ORDER BY created_at DESC) FROM recent), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_growth_repair_strategy_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_repair_strategy_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_growth_repair_strategy_override(
  _signal text,
  _canonical_job_type text,
  _state text,           -- 'active' | 'downranked' | 'blocked'
  _reason text,
  _manual boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_old   text;
BEGIN
  IF NOT has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _state NOT IN ('active','downranked','blocked') THEN
    RAISE EXCEPTION 'invalid state: %', _state USING ERRCODE = '22023';
  END IF;
  IF COALESCE(length(trim(_reason)),0) < 3 THEN
    RAISE EXCEPTION 'reason required (min 3 chars)' USING ERRCODE = '22023';
  END IF;

  SELECT governance_state INTO v_old
    FROM public.growth_repair_strategy_state
   WHERE signal = _signal AND canonical_job_type = _canonical_job_type;

  INSERT INTO public.growth_repair_strategy_state
    (signal, canonical_job_type, governance_state,
     manual_override, override_reason, override_by,
     state_changed_at)
  VALUES
    (_signal, _canonical_job_type, _state,
     _manual, _reason, v_actor, now())
  ON CONFLICT (signal, canonical_job_type) DO UPDATE
    SET governance_state = EXCLUDED.governance_state,
        manual_override  = EXCLUDED.manual_override,
        override_reason  = EXCLUDED.override_reason,
        override_by      = EXCLUDED.override_by,
        state_changed_at = CASE
          WHEN public.growth_repair_strategy_state.governance_state
            <> EXCLUDED.governance_state
          THEN now()
          ELSE public.growth_repair_strategy_state.state_changed_at
        END,
        updated_at = now();

  INSERT INTO public.auto_heal_log
    (action_type, target_id, target_type, trigger_source,
     input_params, result_status, metadata)
  VALUES
    ('growth_repair_strategy_state_overridden',
     _signal || '|' || _canonical_job_type,
     'growth_repair_strategy',
     'admin_set_growth_repair_strategy_override',
     jsonb_build_object('signal', _signal,
                        'canonical_job_type', _canonical_job_type,
                        'reason', _reason,
                        'manual', _manual),
     'overridden',
     jsonb_build_object('old_state', COALESCE(v_old,'none'),
                        'new_state', _state,
                        'actor', v_actor));

  RETURN jsonb_build_object('signal', _signal,
                            'canonical_job_type', _canonical_job_type,
                            'old_state', COALESCE(v_old,'none'),
                            'new_state', _state,
                            'manual_override', _manual);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_growth_repair_strategy_override(text,text,text,text,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_growth_repair_strategy_override(text,text,text,text,boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_recompute_growth_repair_governance(
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF NOT has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(length(trim(_reason)),0) < 3 THEN
    RAISE EXCEPTION 'reason required (min 3 chars)' USING ERRCODE = '22023';
  END IF;
  RETURN public._growth_repair_recompute_strategy_governance(
    _reason, v_actor, 'admin_recompute_growth_repair_governance');
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_recompute_growth_repair_governance(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recompute_growth_repair_governance(text) TO authenticated;

-- 6) Init audit ---------------------------------------------------------------
INSERT INTO public.auto_heal_log
  (action_type, target_id, target_type, trigger_source, input_params, result_status, metadata)
VALUES
  ('track_2_3f_init', NULL, 'system', 'migration',
   '{}'::jsonb, 'ok',
   jsonb_build_object('components',
     jsonb_build_array(
       'growth_repair_strategy_state',
       'v_growth_repair_strategy_health_v1',
       '_growth_repair_recompute_strategy_governance',
       '_growth_repair_decide (governance gate + downrank cooldown)',
       'admin_growth_repair_strategy_health',
       'admin_set_growth_repair_strategy_override',
       'admin_recompute_growth_repair_governance')));
