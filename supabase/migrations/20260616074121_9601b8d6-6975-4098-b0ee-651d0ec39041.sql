
-- =========================================
-- KIMI.INTELLIGENCE.1b — Auto-Apply Policy
-- =========================================

-- 1) Policy table (singleton)
CREATE TABLE IF NOT EXISTS public.quality_intelligence_auto_apply_policy (
  id                       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                  boolean NOT NULL DEFAULT true,
  min_confidence           numeric NOT NULL DEFAULT 0.85,
  allowed_priorities       text[]  NOT NULL DEFAULT ARRAY['P0','P1'],
  allowed_action_kinds     text[]  NOT NULL DEFAULT ARRAY[
                              'expand_question_pool',
                              'enqueue_coverage_repair',
                              'enqueue_integrity_check'
                            ],
  required_risk_level      text    NOT NULL DEFAULT 'low',
  required_expected_mutation text  NOT NULL DEFAULT 'repair_job_enqueue_only',
  max_auto_apply_per_day   int     NOT NULL DEFAULT 20,
  max_per_action_kind_per_day int  NOT NULL DEFAULT 10,
  cooldown_failure_rate    numeric NOT NULL DEFAULT 0.30,
  cooldown_window_minutes  int     NOT NULL DEFAULT 60,
  cooldown_min_samples     int     NOT NULL DEFAULT 5,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid
);

GRANT SELECT ON public.quality_intelligence_auto_apply_policy TO authenticated;
GRANT ALL    ON public.quality_intelligence_auto_apply_policy TO service_role;

ALTER TABLE public.quality_intelligence_auto_apply_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qiap_admin_read ON public.quality_intelligence_auto_apply_policy;
CREATE POLICY qiap_admin_read ON public.quality_intelligence_auto_apply_policy
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS qiap_service_all ON public.quality_intelligence_auto_apply_policy;
CREATE POLICY qiap_service_all ON public.quality_intelligence_auto_apply_policy
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.quality_intelligence_auto_apply_policy (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 2) Run ledger
CREATE TABLE IF NOT EXISTS public.quality_intelligence_auto_apply_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_at       timestamptz NOT NULL DEFAULT now(),
  triggered_by       text NOT NULL DEFAULT 'cron',
  candidates_seen    int  NOT NULL DEFAULT 0,
  applied_ok         int  NOT NULL DEFAULT 0,
  applied_fail       int  NOT NULL DEFAULT 0,
  skipped            int  NOT NULL DEFAULT 0,
  cooldown_active    boolean NOT NULL DEFAULT false,
  failure_rate       numeric,
  summary            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qiaar_triggered_at
  ON public.quality_intelligence_auto_apply_runs (triggered_at DESC);

GRANT SELECT ON public.quality_intelligence_auto_apply_runs TO authenticated;
GRANT ALL    ON public.quality_intelligence_auto_apply_runs TO service_role;

ALTER TABLE public.quality_intelligence_auto_apply_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qiaar_admin_read ON public.quality_intelligence_auto_apply_runs;
CREATE POLICY qiaar_admin_read ON public.quality_intelligence_auto_apply_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS qiaar_service_all ON public.quality_intelligence_auto_apply_runs;
CREATE POLICY qiaar_service_all ON public.quality_intelligence_auto_apply_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) Auto-Apply RPC (Wave-1 scope, repair-jobs only)
CREATE OR REPLACE FUNCTION public.admin_auto_apply_quality_intelligence_wave1(
  p_triggered_by text DEFAULT 'cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid               uuid := auth.uid();
  v_is_admin          boolean := (v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::app_role));
  v_is_service        boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                                  OR (current_user = 'service_role');
  v_policy            public.quality_intelligence_auto_apply_policy%ROWTYPE;
  v_today_total       int := 0;
  v_today_per_kind    jsonb := '{}'::jsonb;
  v_recent_total      int := 0;
  v_recent_fail       int := 0;
  v_failure_rate      numeric := 0;
  v_cooldown          boolean := false;
  v_run_id            uuid;
  v_rec               record;
  v_kind_count        int;
  v_apply_result      jsonb;
  v_ok                boolean;
  v_candidates_seen   int := 0;
  v_applied_ok        int := 0;
  v_applied_fail      int := 0;
  v_skipped           int := 0;
  v_summary           jsonb := '[]'::jsonb;
  v_confidence        numeric;
  v_risk              text;
  v_mutation          text;
BEGIN
  IF NOT (v_is_admin OR v_is_service) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_policy FROM public.quality_intelligence_auto_apply_policy WHERE id = 1;
  IF NOT FOUND OR NOT v_policy.enabled THEN
    INSERT INTO public.quality_intelligence_auto_apply_runs (triggered_by, summary)
      VALUES (p_triggered_by, jsonb_build_object('reason','policy_disabled'))
      RETURNING id INTO v_run_id;
    RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'reason','policy_disabled');
  END IF;

  -- Today's auto-apply counts (per kind + global) from job_queue idempotency keys
  WITH today AS (
    SELECT split_part(j.idempotency_key, ':', 3) AS action_kind
    FROM public.job_queue j
    WHERE j.idempotency_key LIKE 'quality_intelligence:%'
      AND j.created_at >= date_trunc('day', now())
  )
  SELECT count(*),
         COALESCE(jsonb_object_agg(action_kind, c), '{}'::jsonb)
    INTO v_today_total, v_today_per_kind
    FROM (
      SELECT action_kind, count(*) AS c FROM today GROUP BY action_kind
    ) s;

  -- Failure-rate cooldown (last N minutes)
  SELECT count(*) FILTER (WHERE true),
         count(*) FILTER (WHERE j.status IN ('failed','dead_letter'))
    INTO v_recent_total, v_recent_fail
    FROM public.job_queue j
   WHERE j.idempotency_key LIKE 'quality_intelligence:%'
     AND j.created_at >= now() - make_interval(mins => v_policy.cooldown_window_minutes);

  IF v_recent_total >= v_policy.cooldown_min_samples THEN
    v_failure_rate := v_recent_fail::numeric / NULLIF(v_recent_total,0);
    v_cooldown := v_failure_rate > v_policy.cooldown_failure_rate;
  END IF;

  IF v_cooldown THEN
    INSERT INTO public.quality_intelligence_auto_apply_runs (
      triggered_by, cooldown_active, failure_rate, summary
    ) VALUES (
      p_triggered_by, true, v_failure_rate,
      jsonb_build_object('reason','cooldown_active','failure_rate',v_failure_rate)
    ) RETURNING id INTO v_run_id;
    RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'reason','cooldown_active',
                              'failure_rate', v_failure_rate);
  END IF;

  IF v_today_total >= v_policy.max_auto_apply_per_day THEN
    INSERT INTO public.quality_intelligence_auto_apply_runs (
      triggered_by, summary
    ) VALUES (
      p_triggered_by,
      jsonb_build_object('reason','daily_cap_reached','today_total',v_today_total)
    ) RETURNING id INTO v_run_id;
    RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'reason','daily_cap_reached');
  END IF;

  -- Walk candidates
  FOR v_rec IN
    SELECT r.id, r.action_kind, r.priority, r.estimated_impact, r.proposed_payload
      FROM public.quality_intelligence_recommendations r
     WHERE r.status = 'pending'
       AND r.priority   = ANY (v_policy.allowed_priorities)
       AND r.action_kind = ANY (v_policy.allowed_action_kinds)
     ORDER BY r.priority ASC, r.created_at ASC
     LIMIT 200
  LOOP
    v_candidates_seen := v_candidates_seen + 1;

    -- Confidence (numeric) from estimated_impact.confidence or .score
    v_confidence := COALESCE(
      NULLIF(v_rec.estimated_impact->>'confidence','')::numeric,
      NULLIF(v_rec.estimated_impact->>'score','')::numeric,
      0
    );
    v_risk := COALESCE(NULLIF(v_rec.proposed_payload->>'risk_level',''), 'low');
    v_mutation := COALESCE(NULLIF(v_rec.proposed_payload->>'expected_mutation',''),
                           'repair_job_enqueue_only');

    IF v_confidence < v_policy.min_confidence THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','skipped',
        'reason','LOW_CONFIDENCE', 'confidence', v_confidence
      );
      CONTINUE;
    END IF;

    IF v_risk <> v_policy.required_risk_level THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','skipped',
        'reason','RISK_NOT_LOW', 'risk_level', v_risk
      );
      CONTINUE;
    END IF;

    IF v_mutation <> v_policy.required_expected_mutation THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','skipped',
        'reason','MUTATION_NOT_ALLOWED', 'expected_mutation', v_mutation
      );
      CONTINUE;
    END IF;

    -- Per-kind daily cap
    v_kind_count := COALESCE((v_today_per_kind->>v_rec.action_kind)::int, 0);
    IF v_kind_count >= v_policy.max_per_action_kind_per_day THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','skipped',
        'reason','PER_KIND_CAP', 'action_kind', v_rec.action_kind, 'count', v_kind_count
      );
      CONTINUE;
    END IF;

    -- Global daily cap (re-check incl. successes so far in this run)
    IF (v_today_total + v_applied_ok) >= v_policy.max_auto_apply_per_day THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','skipped', 'reason','DAILY_CAP_REACHED'
      );
      CONTINUE;
    END IF;

    -- Approve, then apply via bridge
    UPDATE public.quality_intelligence_recommendations
       SET status = 'approved',
           decided_by = v_uid,
           decided_at = now(),
           decision_note = COALESCE(decision_note,'') || ' [auto-apply policy]'
     WHERE id = v_rec.id;

    BEGIN
      v_apply_result := public.admin_apply_quality_intelligence_recommendation(v_rec.id);
      v_ok := COALESCE((v_apply_result->>'ok')::boolean, false);
    EXCEPTION WHEN OTHERS THEN
      v_apply_result := jsonb_build_object('ok', false, 'reason_code','EXCEPTION','error',SQLERRM);
      v_ok := false;
    END;

    IF v_ok THEN
      v_applied_ok := v_applied_ok + 1;
      v_today_per_kind := jsonb_set(
        v_today_per_kind,
        ARRAY[v_rec.action_kind],
        to_jsonb(v_kind_count + 1),
        true
      );
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','applied',
        'action_kind', v_rec.action_kind, 'result', v_apply_result
      );
    ELSE
      v_applied_fail := v_applied_fail + 1;
      -- Roll status back so a human can inspect
      UPDATE public.quality_intelligence_recommendations
         SET status = 'pending',
             decision_note = COALESCE(decision_note,'') || ' [auto-apply failed: ' ||
                             COALESCE(v_apply_result->>'reason_code','ERR') || ']'
       WHERE id = v_rec.id;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','failed',
        'action_kind', v_rec.action_kind, 'result', v_apply_result
      );
    END IF;
  END LOOP;

  INSERT INTO public.quality_intelligence_auto_apply_runs (
    triggered_by, candidates_seen, applied_ok, applied_fail, skipped,
    cooldown_active, failure_rate, summary
  ) VALUES (
    p_triggered_by, v_candidates_seen, v_applied_ok, v_applied_fail, v_skipped,
    false, v_failure_rate, v_summary
  ) RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'candidates_seen', v_candidates_seen,
    'applied_ok', v_applied_ok,
    'applied_fail', v_applied_fail,
    'skipped', v_skipped,
    'failure_rate', v_failure_rate,
    'today_total_after', v_today_total + v_applied_ok
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_auto_apply_quality_intelligence_wave1(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_auto_apply_quality_intelligence_wave1(text)
  TO authenticated, service_role;
