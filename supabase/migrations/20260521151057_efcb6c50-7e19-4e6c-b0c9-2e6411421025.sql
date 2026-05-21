
-- 1) Schema additions
ALTER TABLE public.ai_eval_datasets
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.runtime_action_results
  ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $$ BEGIN
  CREATE UNIQUE INDEX runtime_action_results_idem_uniq
    ON public.runtime_action_results (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.policy_freeze_state (
  policy_key text PRIMARY KEY,
  frozen_until timestamptz NOT NULL,
  reason text NOT NULL,
  frozen_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.policy_freeze_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "pfs_admin_read" ON public.policy_freeze_state FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "pfs_svc_write" ON public.policy_freeze_state TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.alert_silences (
  alert_key text PRIMARY KEY,
  silenced_until timestamptz NOT NULL,
  reason text NOT NULL,
  silenced_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alert_silences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "as_admin_read" ON public.alert_silences FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "as_svc_write" ON public.alert_silences TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Dispatcher
CREATE OR REPLACE FUNCTION public.fn_runtime_action_execute(_result_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.runtime_action_results%ROWTYPE;
  v_a public.runtime_safe_actions%ROWTYPE;
  v_started timestamptz := clock_timestamp();
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_outcome jsonb := '{}'::jsonb;
  v_rollback uuid;
  v_err text;
  v_payload jsonb;
  v_key text;
  v_until timestamptz;
  v_target_id text;
  v_user uuid;
  v_curr uuid;
  v_count int;
BEGIN
  SELECT * INTO v_r FROM public.runtime_action_results WHERE id = _result_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_result_id: %', _result_id;
  END IF;
  IF v_r.status <> 'pending' THEN
    RETURN; -- idempotent
  END IF;

  SELECT * INTO v_a FROM public.runtime_safe_actions WHERE action_key = v_r.action_key;
  v_payload := COALESCE(v_r.payload, '{}'::jsonb);

  UPDATE public.runtime_action_results SET status='running' WHERE id=_result_id;

  BEGIN
    CASE v_r.action_key
      ----------------------------------------------------------------
      WHEN 're_run_eval_window' THEN
        v_outcome := jsonb_build_object('scheduled', true,
                                        'note','Wird vom ai-eval-worker (Cron 6h) übernommen.',
                                        'window', COALESCE(v_payload->>'window','default'));
        v_before := jsonb_build_object('last_cron','ai-eval-worker-6h');
        v_after  := v_outcome;

      ----------------------------------------------------------------
      WHEN 'rollback_policy' THEN
        IF (v_payload ? 'version_id') IS NOT TRUE THEN
          RAISE EXCEPTION 'payload.version_id required';
        END IF;
        v_target_id := v_payload->>'version_id';
        SELECT to_jsonb(pv) INTO v_before FROM public.policy_versions pv WHERE id = v_target_id::uuid;
        SELECT public.fn_rollback_policy_version(v_target_id::uuid) INTO v_rollback;
        SELECT to_jsonb(pv) INTO v_after FROM public.policy_versions pv WHERE id = v_rollback;
        v_outcome := jsonb_build_object('new_version_id', v_rollback);

      ----------------------------------------------------------------
      WHEN 'freeze_policy' THEN
        IF (v_payload ? 'policy_key') IS NOT TRUE THEN
          RAISE EXCEPTION 'payload.policy_key required';
        END IF;
        v_key := v_payload->>'policy_key';
        v_until := COALESCE((v_payload->>'frozen_until')::timestamptz, now() + interval '24 hours');
        SELECT to_jsonb(p) INTO v_before FROM public.policy_freeze_state p WHERE policy_key=v_key;
        INSERT INTO public.policy_freeze_state(policy_key, frozen_until, reason, frozen_by)
        VALUES (v_key, v_until, COALESCE(v_r.reason,'(no reason)'), v_r.actor_uid)
        ON CONFLICT (policy_key) DO UPDATE
          SET frozen_until=EXCLUDED.frozen_until, reason=EXCLUDED.reason, frozen_by=EXCLUDED.frozen_by;
        SELECT to_jsonb(p) INTO v_after FROM public.policy_freeze_state p WHERE policy_key=v_key;
        v_outcome := jsonb_build_object('policy_key', v_key, 'frozen_until', v_until);

      ----------------------------------------------------------------
      WHEN 'disable_dataset' THEN
        IF (v_payload ? 'dataset_key') IS NOT TRUE THEN
          RAISE EXCEPTION 'payload.dataset_key required';
        END IF;
        v_key := v_payload->>'dataset_key';
        SELECT to_jsonb(d) INTO v_before FROM public.ai_eval_datasets d WHERE dataset_key=v_key;
        UPDATE public.ai_eval_datasets SET is_enabled=false WHERE dataset_key=v_key;
        SELECT to_jsonb(d) INTO v_after FROM public.ai_eval_datasets d WHERE dataset_key=v_key;
        IF v_before IS NULL THEN
          RAISE EXCEPTION 'unknown_dataset_key: %', v_key;
        END IF;
        v_outcome := jsonb_build_object('dataset_key', v_key, 'is_enabled', false);

      ----------------------------------------------------------------
      WHEN 'recompute_sequence' THEN
        IF NOT (v_payload ? 'user_id' AND v_payload ? 'curriculum_id') THEN
          RAISE EXCEPTION 'payload.user_id and payload.curriculum_id required';
        END IF;
        v_user := (v_payload->>'user_id')::uuid;
        v_curr := (v_payload->>'curriculum_id')::uuid;
        SELECT count(*) INTO v_count FROM public.fn_compute_adaptive_sequence(v_user, v_curr);
        v_outcome := jsonb_build_object('user_id', v_user, 'curriculum_id', v_curr, 'rows', v_count);
        v_before := jsonb_build_object('user_id', v_user, 'curriculum_id', v_curr);
        v_after  := v_outcome;

      ----------------------------------------------------------------
      WHEN 'silence_alert' THEN
        IF (v_payload ? 'alert_key') IS NOT TRUE THEN
          RAISE EXCEPTION 'payload.alert_key required';
        END IF;
        v_key := v_payload->>'alert_key';
        v_until := COALESCE((v_payload->>'silenced_until')::timestamptz, now() + interval '4 hours');
        SELECT to_jsonb(s) INTO v_before FROM public.alert_silences s WHERE alert_key=v_key;
        INSERT INTO public.alert_silences(alert_key, silenced_until, reason, silenced_by)
        VALUES (v_key, v_until, COALESCE(v_r.reason,'(no reason)'), v_r.actor_uid)
        ON CONFLICT (alert_key) DO UPDATE
          SET silenced_until=EXCLUDED.silenced_until, reason=EXCLUDED.reason, silenced_by=EXCLUDED.silenced_by;
        SELECT to_jsonb(s) INTO v_after FROM public.alert_silences s WHERE alert_key=v_key;
        v_outcome := jsonb_build_object('alert_key', v_key, 'silenced_until', v_until);

      ----------------------------------------------------------------
      WHEN 'trigger_intervention_recheck' THEN
        v_outcome := jsonb_build_object('scheduled', true,
                                        'target_ref', v_payload->'target_ref',
                                        'note','Outcome-Recalc wird vom Intervention-Worker beim nächsten Tick gezogen.');
        v_before := jsonb_build_object('target_ref', v_payload->'target_ref');
        v_after  := v_outcome;

      ----------------------------------------------------------------
      WHEN 'open_evidence_chain' THEN
        v_target_id := v_payload->>'target_id';
        SELECT jsonb_build_object(
          'count', count(*),
          'rows', COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
        ) INTO v_outcome
        FROM (
          SELECT action_type, result_status, target_type, target_id, metadata, created_at
          FROM public.auto_heal_log
          WHERE (v_target_id IS NULL OR target_id = v_target_id)
          ORDER BY created_at DESC
          LIMIT 50
        ) x;
        v_before := jsonb_build_object('target_id', v_target_id);
        v_after  := jsonb_build_object('chain_size', COALESCE(v_outcome->>'count','0'));

      ----------------------------------------------------------------
      ELSE
        RAISE EXCEPTION 'no_handler_for_action: %', v_r.action_key;
    END CASE;

    UPDATE public.runtime_action_results
       SET status='completed',
           before_snapshot = v_before,
           after_snapshot  = v_after,
           outcome         = v_outcome,
           rollback_ref    = v_rollback,
           duration_ms     = (EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started)))::int,
           completed_at    = now()
     WHERE id = _result_id;

    BEGIN
      PERFORM public.fn_emit_audit(
        _action_type    := 'runtime_safe_action_completed',
        _target_type    := 'system',
        _target_id      := _result_id::text,
        _result_status  := 'success',
        _payload        := jsonb_build_object(
          'action_key', v_r.action_key,
          'result_id', _result_id,
          'duration_ms', (EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started)))::int,
          'rollback_ref', v_rollback,
          'outcome', v_outcome
        ),
        _trigger_source := 'safe_actions_dispatcher_v1',
        _error_message  := NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    UPDATE public.runtime_action_results
       SET status='failed',
           error = v_err,
           before_snapshot = v_before,
           duration_ms = (EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started)))::int,
           completed_at = now()
     WHERE id = _result_id;

    BEGIN
      PERFORM public.fn_emit_audit(
        _action_type    := 'runtime_safe_action_failed',
        _target_type    := 'system',
        _target_id      := _result_id::text,
        _result_status  := 'error',
        _payload        := jsonb_build_object('action_key', v_r.action_key, 'result_id', _result_id, 'error', v_err),
        _trigger_source := 'safe_actions_dispatcher_v1',
        _error_message  := v_err
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_runtime_action_execute(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_runtime_action_execute(uuid) TO service_role;

-- 3) Re-wire dispatch RPC: idempotency + synchronous execute
CREATE OR REPLACE FUNCTION public.admin_dispatch_runtime_safe_action(
  _action_key text, _reason text, _payload jsonb DEFAULT '{}'::jsonb, _severity text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_action public.runtime_safe_actions%ROWTYPE;
  v_actor uuid := auth.uid();
  v_result_id uuid;
  v_sev text;
  v_idem text;
  v_existing uuid;
  v_bucket text;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT * INTO v_action FROM public.runtime_safe_actions WHERE action_key = _action_key AND is_enabled = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_or_disabled_action: %', _action_key;
  END IF;

  IF v_action.requires_reason AND (COALESCE(btrim(_reason),'') = '' OR length(btrim(_reason)) < 8) THEN
    RAISE EXCEPTION 'reason_required_min_8_chars';
  END IF;

  v_sev := COALESCE(_severity, v_action.severity);
  v_bucket := to_char(date_trunc('minute', now()) - make_interval(mins => extract(minute from now())::int % 15), 'YYYYMMDDHH24MI');
  v_idem := _action_key || '|' || encode(digest(COALESCE(_payload,'{}'::jsonb)::text, 'sha256'), 'hex') || '|' || v_bucket;

  SELECT id INTO v_existing FROM public.runtime_action_results WHERE idempotency_key = v_idem LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.runtime_action_results
    (action_key, actor_uid, reason, severity, status, payload, dispatched_via, idempotency_key)
  VALUES
    (_action_key, v_actor, _reason, v_sev, 'pending', COALESCE(_payload,'{}'::jsonb), 'admin_ui', v_idem)
  RETURNING id INTO v_result_id;

  BEGIN
    PERFORM public.fn_emit_audit(
      _action_type    := 'runtime_safe_action_dispatched',
      _target_type    := 'system',
      _target_id      := v_result_id::text,
      _result_status  := 'pending',
      _payload        := jsonb_build_object(
        'action_key', _action_key, 'actor', v_actor, 'reason', _reason,
        'result_id', v_result_id, 'severity', v_sev,
        'handler', v_action.dispatch_handler, 'is_destructive', v_action.is_destructive,
        'idempotency_key', v_idem
      ),
      _trigger_source := 'safe_actions_dispatcher_v1',
      _error_message  := NULL
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Synchronous execute (dispatcher captures snapshots + audit + result)
  BEGIN
    PERFORM public.fn_runtime_action_execute(v_result_id);
  EXCEPTION WHEN OTHERS THEN
    -- fn_runtime_action_execute already wrote 'failed' + audit; swallow so caller still gets result_id
    NULL;
  END;

  RETURN v_result_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_runtime_safe_action(text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_runtime_safe_action(text, text, jsonb, text) TO authenticated;
