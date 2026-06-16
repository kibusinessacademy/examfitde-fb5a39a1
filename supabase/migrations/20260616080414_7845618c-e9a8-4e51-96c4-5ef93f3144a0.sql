
CREATE OR REPLACE FUNCTION public.admin_auto_apply_quality_intelligence_wave1(p_triggered_by text DEFAULT 'cron'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  WITH today AS (
    SELECT split_part(j.idempotency_key, ':', 3) AS action_kind
    FROM public.job_queue j
    WHERE j.idempotency_key LIKE 'quality_intelligence:%'
      AND j.created_at >= date_trunc('day', now())
  )
  SELECT count(*),
         COALESCE(jsonb_object_agg(action_kind, c), '{}'::jsonb)
    INTO v_today_total, v_today_per_kind
    FROM (SELECT action_kind, count(*) AS c FROM today GROUP BY action_kind) s;

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

  FOR v_rec IN
    SELECT r.id, r.action_kind, r.priority, r.estimated_impact, r.proposed_payload,
           r.confidence AS col_confidence,
           r.risk_level AS col_risk,
           r.expected_mutation AS col_mutation
      FROM public.quality_intelligence_recommendations r
     WHERE r.status = 'pending'
       AND r.priority   = ANY (v_policy.allowed_priorities)
       AND r.action_kind = ANY (v_policy.allowed_action_kinds)
     ORDER BY r.priority ASC, r.created_at ASC
     LIMIT 200
  LOOP
    v_candidates_seen := v_candidates_seen + 1;

    -- Prefer dedicated columns; fall back to JSON for legacy rows
    v_confidence := COALESCE(
      v_rec.col_confidence,
      NULLIF(v_rec.estimated_impact->>'confidence','')::numeric,
      NULLIF(v_rec.estimated_impact->>'score','')::numeric,
      0
    );
    v_risk := COALESCE(
      NULLIF(v_rec.col_risk,''),
      NULLIF(v_rec.proposed_payload->>'risk_level',''),
      'low'
    );
    v_mutation := COALESCE(
      NULLIF(v_rec.col_mutation,''),
      NULLIF(v_rec.proposed_payload->>'expected_mutation',''),
      'repair_job_enqueue_only'
    );

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

    v_kind_count := COALESCE((v_today_per_kind->>v_rec.action_kind)::int, 0);
    IF v_kind_count >= v_policy.max_per_action_kind_per_day THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','skipped',
        'reason','PER_KIND_CAP', 'action_kind', v_rec.action_kind, 'count', v_kind_count
      );
      CONTINUE;
    END IF;

    IF (v_today_total + v_applied_ok) >= v_policy.max_auto_apply_per_day THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','skipped', 'reason','DAILY_CAP_REACHED'
      );
      CONTINUE;
    END IF;

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
        v_today_per_kind, ARRAY[v_rec.action_kind],
        to_jsonb(v_kind_count + 1), true
      );
      v_summary := v_summary || jsonb_build_object(
        'recommendation_id', v_rec.id, 'status','applied',
        'action_kind', v_rec.action_kind, 'result', v_apply_result
      );
    ELSE
      v_applied_fail := v_applied_fail + 1;
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
    'ok', true, 'run_id', v_run_id,
    'candidates_seen', v_candidates_seen,
    'applied_ok', v_applied_ok,
    'applied_fail', v_applied_fail,
    'skipped', v_skipped,
    'failure_rate', v_failure_rate,
    'today_total_after', v_today_total + v_applied_ok
  );
END;
$function$;
