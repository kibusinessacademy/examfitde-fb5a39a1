
-- ============================================================
-- Track 2.3e — Repair Outcome Verification
-- ============================================================

-- 1) Outcomes table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.growth_repair_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_log_id uuid NOT NULL UNIQUE REFERENCES public.auto_heal_log(id) ON DELETE CASCADE,
  package_id uuid NOT NULL,
  signal text NOT NULL,
  expected_job_type text,
  canonical_job_type text,
  idempotency_key text,
  job_id uuid,
  dispatcher text NOT NULL,                 -- 'growth_local_worker_v1' | 'growth_repair_dispatcher_v1'
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  first_checked_at timestamptz,
  last_checked_at timestamptz,
  verified_at timestamptz,
  verification_attempts int NOT NULL DEFAULT 0,
  outcome text NOT NULL DEFAULT 'pending',  -- pending|signal_closed|job_failed|stale|abandoned
  outcome_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_repair_outcomes_pending
  ON public.growth_repair_outcomes (outcome, last_checked_at NULLS FIRST, dispatched_at)
  WHERE outcome = 'pending';

CREATE INDEX IF NOT EXISTS idx_growth_repair_outcomes_pkg_signal
  ON public.growth_repair_outcomes (package_id, signal, dispatched_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_repair_outcomes_outcome
  ON public.growth_repair_outcomes (outcome, dispatched_at DESC);

ALTER TABLE public.growth_repair_outcomes ENABLE ROW LEVEL SECURITY;

-- Service role only; admins read via RPCs.
DROP POLICY IF EXISTS "service_role_growth_repair_outcomes" ON public.growth_repair_outcomes;
CREATE POLICY "service_role_growth_repair_outcomes"
  ON public.growth_repair_outcomes
  TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.growth_repair_outcomes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.growth_repair_outcomes TO service_role;

-- 2) Trigger: register an outcome row on every dispatched attempt -------------
CREATE OR REPLACE FUNCTION public._growth_repair_register_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pkg uuid;
  v_signal text;
  v_expected text;
  v_canonical text;
  v_idem text;
  v_job uuid;
  v_dispatcher text;
BEGIN
  -- Only on dispatched attempt rows (worker or dispatcher)
  IF NEW.action_type NOT IN ('growth_local_worker_attempt','growth_repair_dispatch_attempt')
     OR NEW.result_status <> 'dispatched' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_pkg     := NULLIF(NEW.target_id,'')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF v_pkg IS NULL THEN RETURN NEW; END IF;

  v_signal     := COALESCE(NEW.metadata->>'signal', NEW.input_params->>'signal');
  v_expected   := COALESCE(NEW.metadata->>'expected_job_type', NEW.input_params->>'expected_job_type');
  v_canonical  := NEW.metadata->>'canonical_job_type';
  v_idem       := NEW.metadata->>'idempotency_key';
  BEGIN
    v_job      := NULLIF(NEW.metadata->>'job_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_job := NULL;
  END;
  v_dispatcher := CASE
    WHEN NEW.action_type = 'growth_local_worker_attempt' THEN 'growth_local_worker_v1'
    ELSE 'growth_repair_dispatcher_v1'
  END;

  IF v_signal IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.growth_repair_outcomes
    (attempt_log_id, package_id, signal, expected_job_type,
     canonical_job_type, idempotency_key, job_id, dispatcher, dispatched_at)
  VALUES
    (NEW.id, v_pkg, v_signal, v_expected,
     v_canonical, v_idem, v_job, v_dispatcher, NEW.created_at)
  ON CONFLICT (attempt_log_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the producing attempt log; log silently.
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_growth_repair_register_outcome ON public.auto_heal_log;
CREATE TRIGGER trg_growth_repair_register_outcome
AFTER INSERT ON public.auto_heal_log
FOR EACH ROW
EXECUTE FUNCTION public._growth_repair_register_outcome();

-- 3) Verifier -----------------------------------------------------------------
-- Looks at pending outcomes that are ripe (dispatched >15min ago, not checked
-- in the last 15min) and resolves them against job_queue + eligibility view.
CREATE OR REPLACE FUNCTION public._growth_repair_verify_outcomes(
  _mode text DEFAULT 'live',     -- 'dry_run' | 'live'
  _limit int DEFAULT 100,
  _reason text DEFAULT NULL,
  _actor uuid DEFAULT NULL,
  _trigger_source text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_limit int := LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
  v_now timestamptz := now();
  v_grace_min int := 15;          -- minimum age before first check
  v_recheck_min int := 15;        -- pause between rechecks
  v_stale_hours int := 4;         -- after this, mark as stale
  v_max_attempts int := 8;        -- after this, mark abandoned
  v_row record;
  v_job_status text;
  v_signal_still_open bool;
  v_new_outcome text;
  v_detail jsonb;
  v_n_scanned int := 0;
  v_n_closed int := 0;
  v_n_job_failed int := 0;
  v_n_stale int := 0;
  v_n_abandoned int := 0;
  v_n_still_pending int := 0;
BEGIN
  FOR v_row IN
    SELECT o.*
    FROM public.growth_repair_outcomes o
    WHERE o.outcome = 'pending'
      AND o.dispatched_at < (v_now - make_interval(mins => v_grace_min))
      AND (o.last_checked_at IS NULL
           OR o.last_checked_at < (v_now - make_interval(mins => v_recheck_min)))
    ORDER BY o.last_checked_at NULLS FIRST, o.dispatched_at
    LIMIT v_limit
  LOOP
    v_n_scanned := v_n_scanned + 1;

    -- Job status (if job_id known)
    v_job_status := NULL;
    IF v_row.job_id IS NOT NULL THEN
      SELECT status INTO v_job_status FROM public.job_queue WHERE id = v_row.job_id;
    END IF;

    -- Is the signal still open in eligibility?
    SELECT EXISTS (
      SELECT 1
      FROM public.v_growth_repair_eligibility_v1 e
      WHERE e.package_id = v_row.package_id
        AND e.signal     = v_row.signal
    ) INTO v_signal_still_open;

    v_new_outcome := NULL;
    v_detail := jsonb_build_object(
      'job_status', v_job_status,
      'signal_still_open', v_signal_still_open,
      'checked_at', v_now
    );

    IF v_job_status = 'failed' THEN
      v_new_outcome := 'job_failed';
      v_n_job_failed := v_n_job_failed + 1;
    ELSIF NOT v_signal_still_open THEN
      v_new_outcome := 'signal_closed';
      v_n_closed := v_n_closed + 1;
    ELSIF v_row.dispatched_at < (v_now - make_interval(hours => v_stale_hours)) THEN
      v_new_outcome := 'stale';
      v_n_stale := v_n_stale + 1;
    ELSIF v_row.verification_attempts + 1 >= v_max_attempts THEN
      v_new_outcome := 'abandoned';
      v_n_abandoned := v_n_abandoned + 1;
    ELSE
      v_n_still_pending := v_n_still_pending + 1;
    END IF;

    IF _mode = 'live' THEN
      UPDATE public.growth_repair_outcomes
         SET first_checked_at = COALESCE(first_checked_at, v_now),
             last_checked_at  = v_now,
             verification_attempts = verification_attempts + 1,
             outcome          = COALESCE(v_new_outcome, outcome),
             verified_at      = CASE WHEN v_new_outcome IS NOT NULL THEN v_now ELSE verified_at END,
             outcome_detail   = v_detail,
             updated_at       = v_now
       WHERE id = v_row.id;

      IF v_new_outcome IS NOT NULL THEN
        INSERT INTO public.auto_heal_log
          (action_type, target_id, target_type, trigger_source,
           input_params, result_status, metadata)
        VALUES
          ('growth_repair_outcome_verified',
           v_row.package_id::text, 'course_package',
           _trigger_source,
           jsonb_build_object('signal', v_row.signal,
                              'expected_job_type', v_row.expected_job_type,
                              'dispatcher', v_row.dispatcher),
           v_new_outcome,
           jsonb_build_object('run_id', v_run_id,
                              'outcome_id', v_row.id,
                              'job_id', v_row.job_id,
                              'job_status', v_job_status,
                              'attempt_log_id', v_row.attempt_log_id,
                              'actor', _actor));
      END IF;
    END IF;
  END LOOP;

  -- Run summary
  IF _mode = 'live' OR v_n_scanned > 0 THEN
    INSERT INTO public.auto_heal_log
      (action_type, target_id, target_type, trigger_source,
       input_params, result_status, metadata)
    VALUES
      ('growth_repair_outcome_run',
       v_run_id::text, 'system',
       _trigger_source,
       jsonb_build_object('mode', _mode, 'limit', v_limit, 'reason', _reason),
       'ok',
       jsonb_build_object('run_id', v_run_id, 'mode', _mode,
                          'scanned', v_n_scanned,
                          'signal_closed', v_n_closed,
                          'job_failed', v_n_job_failed,
                          'stale', v_n_stale,
                          'abandoned', v_n_abandoned,
                          'still_pending', v_n_still_pending,
                          'actor', _actor));
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'mode', _mode,
    'scanned', v_n_scanned,
    'signal_closed', v_n_closed,
    'job_failed', v_n_job_failed,
    'stale', v_n_stale,
    'abandoned', v_n_abandoned,
    'still_pending', v_n_still_pending
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public._growth_repair_verify_outcomes(text,int,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._growth_repair_verify_outcomes(text,int,text,uuid,text) TO service_role;

-- 4) Admin RPCs ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_growth_repair_outcomes_summary()
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

  WITH base AS (
    SELECT outcome, dispatcher, signal,
           dispatched_at, verified_at, verification_attempts
      FROM public.growth_repair_outcomes
     WHERE dispatched_at > now() - interval '14 days'
  ),
  totals AS (
    SELECT
      COUNT(*)                                                   AS total,
      COUNT(*) FILTER (WHERE outcome='pending')                  AS pending,
      COUNT(*) FILTER (WHERE outcome='signal_closed')            AS signal_closed,
      COUNT(*) FILTER (WHERE outcome='job_failed')               AS job_failed,
      COUNT(*) FILTER (WHERE outcome='stale')                    AS stale,
      COUNT(*) FILTER (WHERE outcome='abandoned')                AS abandoned,
      COUNT(*) FILTER (WHERE outcome <> 'pending')               AS verified,
      AVG(EXTRACT(EPOCH FROM (verified_at - dispatched_at))/60.0)
        FILTER (WHERE outcome='signal_closed')                   AS avg_close_minutes
    FROM base
  ),
  by_signal AS (
    SELECT signal,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE outcome='signal_closed') AS closed,
           COUNT(*) FILTER (WHERE outcome='job_failed')    AS failed,
           COUNT(*) FILTER (WHERE outcome='stale')         AS stale,
           COUNT(*) FILTER (WHERE outcome='pending')       AS pending
      FROM base GROUP BY signal
  ),
  by_dispatcher AS (
    SELECT dispatcher,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE outcome='signal_closed') AS closed,
           COUNT(*) FILTER (WHERE outcome='job_failed')    AS failed
      FROM base GROUP BY dispatcher
  ),
  recent_runs AS (
    SELECT id, created_at, result_status, metadata
      FROM public.auto_heal_log
     WHERE action_type='growth_repair_outcome_run'
     ORDER BY created_at DESC
     LIMIT 10
  )
  SELECT jsonb_build_object(
    'window_days', 14,
    'totals', (SELECT to_jsonb(totals) FROM totals),
    'by_signal', COALESCE((SELECT jsonb_agg(to_jsonb(by_signal) ORDER BY total DESC) FROM by_signal), '[]'::jsonb),
    'by_dispatcher', COALESCE((SELECT jsonb_agg(to_jsonb(by_dispatcher)) FROM by_dispatcher), '[]'::jsonb),
    'recent_runs', COALESCE((SELECT jsonb_agg(to_jsonb(recent_runs) ORDER BY created_at DESC) FROM recent_runs), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_growth_repair_outcomes_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_repair_outcomes_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_growth_repair_outcomes_recent(
  _outcome text DEFAULT NULL,
  _limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_out jsonb; v_limit int := LEAST(GREATEST(COALESCE(_limit,50),1), 500);
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.dispatched_at DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT o.id, o.package_id, cp.package_key, cp.title AS package_title,
           o.signal, o.expected_job_type, o.canonical_job_type,
           o.dispatcher, o.outcome, o.dispatched_at, o.verified_at,
           o.verification_attempts, o.outcome_detail, o.job_id
      FROM public.growth_repair_outcomes o
      LEFT JOIN public.course_packages cp ON cp.id = o.package_id
     WHERE (_outcome IS NULL OR o.outcome = _outcome)
     ORDER BY o.dispatched_at DESC
     LIMIT v_limit
  ) r;

  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_growth_repair_outcomes_recent(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_repair_outcomes_recent(text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_growth_repair_verify_now(
  _mode text DEFAULT 'dry_run',
  _limit int DEFAULT 100,
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
  IF _mode NOT IN ('dry_run','live') THEN
    RAISE EXCEPTION 'invalid mode: %', _mode USING ERRCODE = '22023';
  END IF;
  IF _mode = 'live' AND (COALESCE(length(trim(_reason)),0) < 3) THEN
    RAISE EXCEPTION 'reason required (min 3 chars) for live verify' USING ERRCODE = '22023';
  END IF;
  RETURN public._growth_repair_verify_outcomes(
    _mode, _limit, _reason, v_actor, 'admin_growth_repair_verify_now'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_growth_repair_verify_now(text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_growth_repair_verify_now(text,int,text) TO authenticated;

-- 5) Backfill outcome rows for dispatches in the last 24h ---------------------
INSERT INTO public.growth_repair_outcomes
  (attempt_log_id, package_id, signal, expected_job_type,
   canonical_job_type, idempotency_key, job_id, dispatcher, dispatched_at)
SELECT l.id,
       NULLIF(l.target_id,'')::uuid,
       COALESCE(l.metadata->>'signal', l.input_params->>'signal'),
       COALESCE(l.metadata->>'expected_job_type', l.input_params->>'expected_job_type'),
       l.metadata->>'canonical_job_type',
       l.metadata->>'idempotency_key',
       NULLIF(l.metadata->>'job_id','')::uuid,
       CASE WHEN l.action_type='growth_local_worker_attempt'
            THEN 'growth_local_worker_v1'
            ELSE 'growth_repair_dispatcher_v1' END,
       l.created_at
  FROM public.auto_heal_log l
 WHERE l.action_type IN ('growth_local_worker_attempt','growth_repair_dispatch_attempt')
   AND l.result_status = 'dispatched'
   AND l.created_at > now() - interval '24 hours'
   AND COALESCE(l.metadata->>'signal', l.input_params->>'signal') IS NOT NULL
   AND NULLIF(l.target_id,'') IS NOT NULL
ON CONFLICT (attempt_log_id) DO NOTHING;

-- 6) Init audit ---------------------------------------------------------------
INSERT INTO public.auto_heal_log
  (action_type, target_id, target_type, trigger_source, input_params, result_status, metadata)
VALUES
  ('track_2_3e_init', NULL, 'system', 'migration',
   '{}'::jsonb, 'ok',
   jsonb_build_object('components',
     jsonb_build_array(
       'growth_repair_outcomes table',
       'trg_growth_repair_register_outcome',
       '_growth_repair_verify_outcomes',
       'admin_growth_repair_outcomes_summary',
       'admin_growth_repair_outcomes_recent',
       'admin_growth_repair_verify_now',
       '24h backfill'),
     'notes', 'Cron will be registered separately via supabase--insert (uses service_role context).'
   ));
