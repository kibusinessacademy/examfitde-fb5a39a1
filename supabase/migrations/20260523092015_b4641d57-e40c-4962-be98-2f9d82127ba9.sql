-- ─────────────────────────────────────────────────────────────────────
-- P20 Cut 0B — P18 → GIL Bridge + Manual Signal Insert
-- Reuse: gil_market_signals (no new table), fn_emit_audit (no new audit system)
-- ─────────────────────────────────────────────────────────────────────

-- 1) Audit contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module)
VALUES
  ('gil_internal_drift_signal_created',
     ARRAY['idempotency_key','drift_type','severity','source','signal_id','result'],
     1, 'governance.p18.gil_bridge'),
  ('gil_manual_signal_created',
     ARRAY['signal_type','source','severity','signal_id','reason'],
     1, 'governance.gil.manual')
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    schema_version = EXCLUDED.schema_version,
    owner_module = EXCLUDED.owner_module,
    updated_at = now();

-- 2) Idempotency: one P18 ledger key → one GIL signal
CREATE UNIQUE INDEX IF NOT EXISTS uq_gil_market_signals_p18_idem
  ON public.gil_market_signals ((payload->>'idempotency_key'))
  WHERE source = 'p18' AND signal_type = 'internal_drift';

-- 3) Bridge RPC
CREATE OR REPLACE FUNCTION public.admin_bridge_p18_drift_to_gil(
  p_idempotency_key text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ledger public.p18_idempotency_ledger;
  v_existing_id uuid;
  v_new_id uuid;
  v_severity text;
  v_confidence numeric;
  v_title text;
  v_summary text;
  v_payload jsonb;
  v_result text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF coalesce(length(trim(p_reason)), 0) < 8 THEN
    RAISE EXCEPTION 'reason must be at least 8 characters';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key required';
  END IF;

  SELECT * INTO v_ledger
  FROM public.p18_idempotency_ledger
  WHERE idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p18 ledger entry not found for idempotency_key';
  END IF;

  -- Only bridgeable from active states
  IF v_ledger.status NOT IN ('detected','escalated','heal_requested','healed','rejected') THEN
    RAISE EXCEPTION 'p18 ledger status % is not bridgeable', v_ledger.status;
  END IF;

  -- Already bridged?
  SELECT id INTO v_existing_id
  FROM public.gil_market_signals
  WHERE source = 'p18'
    AND signal_type = 'internal_drift'
    AND (payload->>'idempotency_key') = p_idempotency_key
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    PERFORM public.fn_emit_audit(
      'gil_internal_drift_signal_created',
      jsonb_build_object(
        'idempotency_key', p_idempotency_key,
        'drift_type', v_ledger.drift_type,
        'severity', v_ledger.severity,
        'source', 'p18',
        'signal_id', v_existing_id,
        'result', 'already_exists',
        'reason', p_reason
      ),
      'governance', v_existing_id::text, 'success'
    );
    RETURN jsonb_build_object(
      'ok', true, 'result', 'already_exists',
      'signal_id', v_existing_id,
      'idempotency_key', p_idempotency_key
    );
  END IF;

  -- Map severity & confidence (mirrors src/lib/governance/p18-gil-bridge.ts)
  v_severity := CASE v_ledger.severity
    WHEN 'block' THEN 'critical'
    WHEN 'warn'  THEN 'warning'
    ELSE 'info'
  END;
  v_confidence := CASE v_ledger.severity
    WHEN 'block' THEN 0.9
    WHEN 'warn'  THEN 0.7
    ELSE 0.5
  END;

  v_title := left(
    '[P18] ' || v_ledger.drift_type || ' — ' ||
    COALESCE(v_ledger.matched_system_ids[1], 'system'),
    200
  );
  v_summary := 'P18 Drift "' || v_ledger.drift_type ||
               '" — Status=' || v_ledger.status ||
               ', Verdict=' || v_ledger.verdict ||
               ', Systeme=' || COALESCE(array_length(v_ledger.matched_system_ids, 1), 0)::text;

  v_payload := jsonb_build_object(
    'drift_type', v_ledger.drift_type,
    'idempotency_key', v_ledger.idempotency_key,
    'target_fingerprint', v_ledger.target_fingerprint,
    'policy_version', v_ledger.policy_version,
    'trigger_source', v_ledger.trigger_source,
    'matched_system_ids', to_jsonb(v_ledger.matched_system_ids),
    'confidence', v_confidence,
    'evidence_refs', jsonb_build_array('p18:ledger:' || v_ledger.idempotency_key),
    'tags', jsonb_build_array('p18','internal_drift', v_ledger.drift_type)
  );

  INSERT INTO public.gil_market_signals (
    signal_type, source, severity, title, summary, payload
  ) VALUES (
    'internal_drift', 'p18', v_severity, v_title, v_summary, v_payload
  )
  RETURNING id INTO v_new_id;

  v_result := 'created';

  PERFORM public.fn_emit_audit(
    'gil_internal_drift_signal_created',
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'drift_type', v_ledger.drift_type,
      'severity', v_ledger.severity,
      'source', 'p18',
      'signal_id', v_new_id,
      'result', v_result,
      'reason', p_reason
    ),
    'governance', v_new_id::text, 'success'
  );

  RETURN jsonb_build_object(
    'ok', true, 'result', v_result,
    'signal_id', v_new_id,
    'idempotency_key', p_idempotency_key,
    'severity', v_severity
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_bridge_p18_drift_to_gil(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bridge_p18_drift_to_gil(text,text) TO authenticated;

-- 4) Manual signal insert RPC (admin-gated, reason ≥ 8 chars)
CREATE OR REPLACE FUNCTION public.admin_create_manual_market_signal(
  p_signal_type text,
  p_severity text,
  p_title text,
  p_summary text,
  p_source text,
  p_confidence numeric,
  p_tags text[],
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_severity text;
  v_signal_type text;
  v_source text;
  v_payload jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF coalesce(length(trim(p_reason)), 0) < 8 THEN
    RAISE EXCEPTION 'reason must be at least 8 characters';
  END IF;
  IF coalesce(length(trim(p_title)), 0) < 3 THEN
    RAISE EXCEPTION 'title required (≥ 3 chars)';
  END IF;

  v_signal_type := COALESCE(NULLIF(trim(p_signal_type), ''), 'manual_observation');
  v_source := COALESCE(NULLIF(trim(p_source), ''), 'manual');
  -- Reserve 'p18' source for the bridge
  IF v_source = 'p18' THEN
    RAISE EXCEPTION 'source "p18" is reserved for the P18 bridge';
  END IF;
  v_severity := CASE
    WHEN p_severity IN ('info','warning','critical') THEN p_severity
    ELSE 'info'
  END;

  v_payload := jsonb_build_object(
    'origin', 'manual',
    'created_by', v_uid,
    'reason', left(p_reason, 600),
    'confidence', COALESCE(p_confidence, 0.5),
    'tags', COALESCE(to_jsonb(p_tags), '[]'::jsonb)
  );

  INSERT INTO public.gil_market_signals (
    signal_type, source, severity, title, summary, payload
  ) VALUES (
    v_signal_type, v_source, v_severity, left(p_title, 200), left(p_summary, 600), v_payload
  )
  RETURNING id INTO v_id;

  PERFORM public.fn_emit_audit(
    'gil_manual_signal_created',
    jsonb_build_object(
      'signal_type', v_signal_type,
      'source', v_source,
      'severity', v_severity,
      'signal_id', v_id,
      'reason', p_reason
    ),
    'governance', v_id::text, 'success'
  );

  RETURN jsonb_build_object('ok', true, 'signal_id', v_id, 'severity', v_severity);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_manual_market_signal(text,text,text,text,text,numeric,text[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_manual_market_signal(text,text,text,text,text,numeric,text[],text) TO authenticated;