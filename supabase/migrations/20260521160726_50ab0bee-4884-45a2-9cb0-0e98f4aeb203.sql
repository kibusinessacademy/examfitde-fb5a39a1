
CREATE TABLE IF NOT EXISTS public.runtime_action_reversible_policies (
  action_key text PRIMARY KEY REFERENCES public.runtime_safe_actions(action_key) ON DELETE CASCADE,
  is_reversible boolean NOT NULL DEFAULT false,
  max_age_minutes integer NOT NULL DEFAULT 60 CHECK (max_age_minutes BETWEEN 1 AND 10080),
  rollback_handler_key text,
  requires_admin_confirm boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.runtime_action_reversible_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rarp_admin_read ON public.runtime_action_reversible_policies;
CREATE POLICY rarp_admin_read ON public.runtime_action_reversible_policies
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

ALTER TABLE public.runtime_action_results
  ADD COLUMN IF NOT EXISTS parent_action_id uuid REFERENCES public.runtime_action_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_rollback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS simulation_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_runtime_action_results_parent
  ON public.runtime_action_results(parent_action_id) WHERE parent_action_id IS NOT NULL;

INSERT INTO public.runtime_action_reversible_policies
  (action_key, is_reversible, max_age_minutes, rollback_handler_key, requires_admin_confirm, notes) VALUES
  ('freeze_policy',     true,  1440, 'policy.unfreeze',     true,  'Undoes policy_freeze_state upsert within 24h.'),
  ('silence_alert',     true,  240,  'observability.unsilence', true, 'Removes alert_silences row within 4h.'),
  ('disable_dataset',   true,  1440, 'eval.enable_dataset', true,  'Re-enables ai_eval_datasets row within 24h.'),
  ('rollback_policy',   false, 60,   NULL,                  true,  'Rollbacks of rollbacks are not supported.'),
  ('recompute_sequence',false, 60,   NULL,                  false, 'Compute is idempotent — no inverse needed.'),
  ('re_run_eval_window',false, 60,   NULL,                  false, 'Worker-driven re-run cannot be unscheduled atomically.'),
  ('trigger_intervention_recheck', false, 60, NULL, false, 'Recheck is read-mostly.'),
  ('open_evidence_chain', false, 60, NULL, false, 'Read-only.')
ON CONFLICT (action_key) DO UPDATE
  SET is_reversible=EXCLUDED.is_reversible,
      max_age_minutes=EXCLUDED.max_age_minutes,
      rollback_handler_key=EXCLUDED.rollback_handler_key,
      requires_admin_confirm=EXCLUDED.requires_admin_confirm,
      notes=EXCLUDED.notes,
      updated_at=now();

CREATE OR REPLACE FUNCTION public.fn_runtime_action_simulate(
  _action_key text, _payload jsonb DEFAULT '{}'::jsonb,
  _target_type text DEFAULT NULL, _target_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action public.runtime_safe_actions%ROWTYPE;
  v_policy public.runtime_action_reversible_policies%ROWTYPE;
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_blast  jsonb := '{}'::jsonb;
  v_warnings text[] := ARRAY[]::text[];
  v_risk int := 0;
BEGIN
  SELECT * INTO v_action FROM public.runtime_safe_actions WHERE action_key = _action_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','UNKNOWN_ACTION','action_key',_action_key);
  END IF;
  IF NOT v_action.is_enabled THEN v_warnings := v_warnings || 'action_disabled'; END IF;
  SELECT * INTO v_policy FROM public.runtime_action_reversible_policies WHERE action_key = _action_key;

  IF _action_key = 'freeze_policy' THEN
    SELECT to_jsonb(p.*) INTO v_before FROM public.policy_freeze_state p
      WHERE p.policy_key = COALESCE(_payload->>'policy_key','');
    v_after := jsonb_build_object('policy_key',_payload->>'policy_key',
      'frozen_until', COALESCE(_payload->>'frozen_until',(now()+interval '24 hours')::text),
      'reason', _payload->>'reason');
    v_blast := jsonb_build_object('affected_policy_keys',1,'currently_frozen',(v_before IS NOT NULL));
  ELSIF _action_key = 'silence_alert' THEN
    SELECT to_jsonb(a.*) INTO v_before FROM public.alert_silences a
      WHERE a.alert_key = COALESCE(_payload->>'alert_key','');
    v_after := jsonb_build_object('alert_key',_payload->>'alert_key',
      'silenced_until', COALESCE(_payload->>'silenced_until',(now()+interval '4 hours')::text),
      'reason',_payload->>'reason');
    v_blast := jsonb_build_object('affected_alerts',1);
  ELSIF _action_key = 'disable_dataset' THEN
    SELECT jsonb_build_object('id',id,'name',name,'is_enabled',is_enabled) INTO v_before
      FROM public.ai_eval_datasets WHERE id = NULLIF(_payload->>'dataset_id','')::uuid;
    v_after := COALESCE(v_before,'{}'::jsonb) || jsonb_build_object('is_enabled',false);
    v_blast := jsonb_build_object(
      'affected_datasets', CASE WHEN v_before IS NULL THEN 0 ELSE 1 END,
      'downstream_eval_runs_7d',
      COALESCE((SELECT count(*) FROM public.ai_eval_runs
                WHERE dataset_id = NULLIF(_payload->>'dataset_id','')::uuid
                  AND created_at > now() - interval '7 days'),0));
  ELSIF _action_key = 'recompute_sequence' THEN
    v_before := jsonb_build_object('user_id',_payload->>'user_id','curriculum_id',_payload->>'curriculum_id');
    v_after  := v_before || jsonb_build_object('action','recompute');
    v_blast  := jsonb_build_object('affected_users',1,'idempotent',true);
  ELSIF _action_key = 'rollback_policy' THEN
    v_before := jsonb_build_object('version_id',_payload->>'version_id');
    v_after  := jsonb_build_object('new_version_pending',true);
    v_blast  := jsonb_build_object('affected_policies',1,'high_risk',true);
    v_risk := v_risk + 30;
  ELSE
    v_before := jsonb_build_object('handler',v_action.dispatch_handler);
    v_after  := v_before || jsonb_build_object('would_invoke',true);
    v_blast  := jsonb_build_object('scope','unknown');
  END IF;

  v_risk := v_risk + CASE v_action.risk_level
    WHEN 'LOW' THEN 5 WHEN 'MEDIUM' THEN 20 WHEN 'HIGH' THEN 50 WHEN 'CRITICAL' THEN 80 ELSE 10 END;
  IF v_action.dangerous_action THEN v_risk := v_risk + 10; END IF;
  IF COALESCE(v_policy.is_reversible,false) = false THEN
    v_warnings := v_warnings || 'not_reversible';
    v_risk := v_risk + 10;
  END IF;

  RETURN jsonb_build_object(
    'action_key',_action_key,
    'would_execute', v_action.is_enabled,
    'risk_level', v_action.risk_level,
    'risk_score', LEAST(v_risk,100),
    'reversible', COALESCE(v_policy.is_reversible,false),
    'reversible_window_min', COALESCE(v_policy.max_age_minutes,0),
    'predicted_before', v_before,
    'predicted_after',  v_after,
    'predicted_diff',   jsonb_build_object('before',v_before,'after',v_after),
    'blast_radius',     v_blast,
    'warnings',         to_jsonb(v_warnings),
    'simulated_at',     now()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_runtime_action_simulate(text,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_runtime_action_simulate(text,jsonb,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_runtime_action_simulate(
  _action_key text, _payload jsonb DEFAULT '{}'::jsonb,
  _target_type text DEFAULT NULL, _target_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  v_result := public.fn_runtime_action_simulate(_action_key,_payload,_target_type,_target_id);
  PERFORM public.fn_emit_audit(
    _action_type=>'runtime_safe_action_simulated',
    _target_type=>COALESCE(_target_type,'runtime_action'),
    _target_id=>_target_id,
    _result_status=>'completed',
    _payload=>jsonb_build_object('action_key',_action_key,'risk_score',v_result->'risk_score','reversible',v_result->'reversible'),
    _trigger_source=>'admin_runtime_action_simulate'
  );
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_runtime_action_simulate(text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_runtime_action_simulate(text,jsonb,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_runtime_action_rollback(
  _result_id uuid, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orig public.runtime_action_results%ROWTYPE;
  v_policy public.runtime_action_reversible_policies%ROWTYPE;
  v_new_id uuid;
  v_age_min int;
  v_before jsonb;
  v_after  jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;
  IF COALESCE(length(trim(_reason)),0) < 8 THEN RAISE EXCEPTION 'reason required (min 8 chars)'; END IF;

  SELECT * INTO v_orig FROM public.runtime_action_results WHERE id = _result_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'result not found'; END IF;
  IF v_orig.status <> 'completed' THEN RAISE EXCEPTION 'only completed actions can be rolled back (status=%)', v_orig.status; END IF;
  IF v_orig.is_rollback THEN RAISE EXCEPTION 'cannot rollback a rollback'; END IF;

  SELECT * INTO v_policy FROM public.runtime_action_reversible_policies WHERE action_key = v_orig.action_key;
  IF NOT FOUND OR NOT v_policy.is_reversible THEN
    RAISE EXCEPTION 'action % is not reversible', v_orig.action_key;
  END IF;

  v_age_min := EXTRACT(EPOCH FROM (now() - COALESCE(v_orig.completed_at, v_orig.created_at)))/60;
  IF v_age_min > v_policy.max_age_minutes THEN
    RAISE EXCEPTION 'rollback window expired (% min > % min)', v_age_min, v_policy.max_age_minutes;
  END IF;

  IF EXISTS (SELECT 1 FROM public.runtime_action_results WHERE parent_action_id = _result_id) THEN
    RAISE EXCEPTION 'rollback already exists for this action';
  END IF;

  v_before := COALESCE(v_orig.after_snapshot,'{}'::jsonb);

  IF v_policy.rollback_handler_key = 'policy.unfreeze' THEN
    DELETE FROM public.policy_freeze_state WHERE policy_key = COALESCE(v_orig.payload->>'policy_key','');
    v_after := jsonb_build_object('policy_key', v_orig.payload->>'policy_key','frozen', false);
  ELSIF v_policy.rollback_handler_key = 'observability.unsilence' THEN
    DELETE FROM public.alert_silences WHERE alert_key = COALESCE(v_orig.payload->>'alert_key','');
    v_after := jsonb_build_object('alert_key', v_orig.payload->>'alert_key','silenced', false);
  ELSIF v_policy.rollback_handler_key = 'eval.enable_dataset' THEN
    UPDATE public.ai_eval_datasets SET is_enabled = true WHERE id = NULLIF(v_orig.payload->>'dataset_id','')::uuid;
    v_after := jsonb_build_object('dataset_id', v_orig.payload->>'dataset_id','is_enabled', true);
  ELSE
    RAISE EXCEPTION 'no rollback handler registered for %', v_orig.action_key;
  END IF;

  INSERT INTO public.runtime_action_results
    (action_key, actor_uid, reason, severity, status, payload,
     before_snapshot, after_snapshot, parent_action_id, is_rollback,
     dispatched_via, completed_at, duration_ms)
  VALUES
    ('rollback:'||v_orig.action_key, auth.uid(), _reason, 'rollback', 'completed',
     v_orig.payload, v_before, v_after, _result_id, true,
     'admin_runtime_action_rollback', now(), 0)
  RETURNING id INTO v_new_id;

  UPDATE public.runtime_action_results SET status = 'rolled_back' WHERE id = _result_id;

  PERFORM public.fn_emit_audit(
    _action_type=>'runtime_safe_action_rolled_back',
    _target_type=>'runtime_action',
    _target_id=>_result_id,
    _result_status=>'completed',
    _payload=>jsonb_build_object('original_action',v_orig.action_key,'rollback_id',v_new_id,'age_minutes',v_age_min),
    _trigger_source=>'admin_runtime_action_rollback'
  );

  RETURN jsonb_build_object('rollback_id', v_new_id, 'original_action', v_orig.action_key, 'reverted', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_runtime_action_rollback(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_runtime_action_rollback(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_runtime_reversible_policies()
RETURNS SETOF public.runtime_action_reversible_policies
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.runtime_action_reversible_policies
   WHERE public.has_role(auth.uid(),'admin')
   ORDER BY is_reversible DESC, action_key;
$$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_reversible_policies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_reversible_policies() TO authenticated;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module) VALUES
  ('runtime_safe_action_simulated',   ARRAY['action_key','risk_score','reversible'], 'runtime_command_center'),
  ('runtime_safe_action_rolled_back', ARRAY['original_action','rollback_id','age_minutes'], 'runtime_command_center')
ON CONFLICT (action_type) DO NOTHING;
