
-- ─────────────────────────────────────────────────────────────────────
-- P18 Cut 3: Idempotency-Ledger (persistente Drift-State-Maschine)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.p18_idempotency_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     text NOT NULL UNIQUE,
  drift_type          text NOT NULL,
  trigger_source      text NOT NULL,
  target_fingerprint  text NOT NULL,
  policy_version      text NOT NULL,
  time_bucket         text NOT NULL,
  status              text NOT NULL DEFAULT 'detected',
  severity            text NOT NULL,
  verdict             text NOT NULL,
  finding_count       int  NOT NULL DEFAULT 0,
  matched_system_ids  text[] NOT NULL DEFAULT '{}',
  allowed_actions     text[] NOT NULL DEFAULT '{}',
  last_action         text,
  action_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p18_ledger_status_check CHECK (status IN (
    'detected','escalated','heal_requested','healed','rejected','suppressed'
  )),
  CONSTRAINT p18_ledger_severity_check CHECK (severity IN ('block','warn','info')),
  CONSTRAINT p18_ledger_drift_type_check CHECK (drift_type IN (
    'ssot_conflict','healability_missing','cross_domain_unbridged',
    'orphan_node','rule_violation','reuse_recommendation','duplicate_registration'
  ))
);

CREATE INDEX IF NOT EXISTS idx_p18_ledger_status         ON public.p18_idempotency_ledger(status);
CREATE INDEX IF NOT EXISTS idx_p18_ledger_drift_type     ON public.p18_idempotency_ledger(drift_type);
CREATE INDEX IF NOT EXISTS idx_p18_ledger_time_bucket    ON public.p18_idempotency_ledger(time_bucket);
CREATE INDEX IF NOT EXISTS idx_p18_ledger_updated_at     ON public.p18_idempotency_ledger(updated_at DESC);

ALTER TABLE public.p18_idempotency_ledger ENABLE ROW LEVEL SECURITY;

-- Admin SELECT (RPC bleibt bevorzugter Zugriffspfad)
DROP POLICY IF EXISTS p18_ledger_admin_select ON public.p18_idempotency_ledger;
CREATE POLICY p18_ledger_admin_select
ON public.p18_idempotency_ledger
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- KEINE INSERT/UPDATE/DELETE Policy → Writes ausschließlich via SECURITY DEFINER RPCs.

REVOKE ALL ON public.p18_idempotency_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.p18_idempotency_ledger TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- updated_at-Trigger
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_p18_ledger_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_p18_ledger_touch_updated_at ON public.p18_idempotency_ledger;
CREATE TRIGGER trg_p18_ledger_touch_updated_at
BEFORE UPDATE ON public.p18_idempotency_ledger
FOR EACH ROW EXECUTE FUNCTION public.fn_p18_ledger_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Audit-Contract Registrierung (SSOT: fn_emit_audit + ops_audit_contract)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module)
VALUES
  ('p18_semantic_drift_detected',
     ARRAY['drift_type','trigger_source','target_fingerprint','policy_version','idempotency_key','severity','verdict','finding_count','matched_system_ids'],
     1, 'governance.p18'),
  ('p18_bounded_heal_requested',
     ARRAY['drift_type','target_fingerprint','policy_version','idempotency_key','requested_action','severity','verdict'],
     1, 'governance.p18'),
  ('p18_bounded_heal_completed',
     ARRAY['drift_type','target_fingerprint','policy_version','idempotency_key','requested_action','result_status'],
     1, 'governance.p18'),
  ('p18_bounded_heal_rejected',
     ARRAY['drift_type','target_fingerprint','policy_version','idempotency_key','requested_action','result_status'],
     1, 'governance.p18')
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    schema_version = EXCLUDED.schema_version,
    owner_module = EXCLUDED.owner_module,
    updated_at = now();

-- ─────────────────────────────────────────────────────────────────────
-- RPC 1: admin_p18_record_detection — upsert by idempotency_key
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_p18_record_detection(
  p_drift jsonb
)
RETURNS public.p18_idempotency_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := p_drift->>'idempotency_key';
  v_drift_type text := p_drift->>'drift_type';
  v_trigger text := p_drift->>'trigger_source';
  v_fp text := p_drift->>'target_fingerprint';
  v_policy text := p_drift->>'policy_version';
  v_bucket text := p_drift->>'time_bucket';
  v_severity text := p_drift->>'severity';
  v_verdict text := COALESCE(p_drift->>'verdict','review_required');
  v_finding_count int := COALESCE((p_drift->>'finding_count')::int, 1);
  v_matched text[] := COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(p_drift->'matched_system_ids')),
    '{}'::text[]
  );
  v_allowed text[] := COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(p_drift->'allowed_actions')),
    '{}'::text[]
  );
  v_initial_status text;
  v_row public.p18_idempotency_ledger;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    -- service_role darf trotzdem (RPC ist SECURITY DEFINER, aber wir gaten manuell)
    IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'p18_record_detection: admin role required';
    END IF;
  END IF;

  IF v_key IS NULL OR v_drift_type IS NULL OR v_trigger IS NULL
     OR v_fp IS NULL OR v_policy IS NULL OR v_bucket IS NULL
     OR v_severity IS NULL THEN
    RAISE EXCEPTION 'p18_record_detection: required fields missing';
  END IF;

  v_initial_status := CASE
    WHEN v_severity = 'block' THEN 'escalated'
    ELSE 'detected'
  END;

  INSERT INTO public.p18_idempotency_ledger (
    idempotency_key, drift_type, trigger_source, target_fingerprint,
    policy_version, time_bucket, status, severity, verdict,
    finding_count, matched_system_ids, allowed_actions
  ) VALUES (
    v_key, v_drift_type, v_trigger, v_fp,
    v_policy, v_bucket, v_initial_status, v_severity, v_verdict,
    v_finding_count, v_matched, v_allowed
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET finding_count   = GREATEST(p18_idempotency_ledger.finding_count, EXCLUDED.finding_count),
      matched_system_ids = EXCLUDED.matched_system_ids,
      allowed_actions = EXCLUDED.allowed_actions,
      verdict         = EXCLUDED.verdict,
      severity        = EXCLUDED.severity,
      updated_at      = now()
  RETURNING * INTO v_row;

  PERFORM public.fn_emit_audit(
    'p18_semantic_drift_detected',
    'governance',
    v_key,
    'success',
    jsonb_build_object(
      'drift_type', v_drift_type,
      'trigger_source', v_trigger,
      'target_fingerprint', v_fp,
      'policy_version', v_policy,
      'idempotency_key', v_key,
      'severity', v_severity,
      'verdict', v_verdict,
      'finding_count', v_finding_count,
      'matched_system_ids', to_jsonb(v_matched)
    ),
    'p18_orchestrator',
    NULL
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_p18_record_detection(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_p18_record_detection(jsonb) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 2: admin_p18_request_heal
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_p18_request_heal(
  p_idempotency_key text,
  p_action          text,
  p_reason          text
)
RETURNS public.p18_idempotency_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.p18_idempotency_ledger;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'p18_request_heal: admin role required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'p18_request_heal: reason must be at least 8 characters';
  END IF;

  IF p_action NOT IN ('SUGGEST_KNOWN_SYSTEM_ENTRY','EMIT_GOVERNANCE_AUDIT','TRIGGER_QUALITY_GATE_RERUN') THEN
    RAISE EXCEPTION 'p18_request_heal: action % not in whitelist', p_action;
  END IF;

  SELECT * INTO v_row FROM public.p18_idempotency_ledger
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'p18_request_heal: ledger entry % not found', p_idempotency_key;
  END IF;

  IF NOT (p_action = ANY (v_row.allowed_actions)) THEN
    RAISE EXCEPTION 'p18_request_heal: action % not in allowed_actions for this drift', p_action;
  END IF;

  IF v_row.status NOT IN ('detected','escalated','heal_requested','rejected') THEN
    RAISE EXCEPTION 'p18_request_heal: status % does not allow heal request', v_row.status;
  END IF;

  UPDATE public.p18_idempotency_ledger
     SET status        = 'heal_requested',
         last_action   = p_action,
         action_reason = btrim(p_reason),
         updated_at    = now()
   WHERE idempotency_key = p_idempotency_key
   RETURNING * INTO v_row;

  PERFORM public.fn_emit_audit(
    'p18_bounded_heal_requested',
    'governance',
    p_idempotency_key,
    'pending',
    jsonb_build_object(
      'drift_type', v_row.drift_type,
      'target_fingerprint', v_row.target_fingerprint,
      'policy_version', v_row.policy_version,
      'idempotency_key', p_idempotency_key,
      'requested_action', p_action,
      'severity', v_row.severity,
      'verdict', v_row.verdict
    ),
    'p18_heal_executor',
    NULL
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_p18_request_heal(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_p18_request_heal(text,text,text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 3: admin_p18_mark_healed
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_p18_mark_healed(
  p_idempotency_key text,
  p_action          text,
  p_result_status   text
)
RETURNS public.p18_idempotency_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.p18_idempotency_ledger;
  v_new_status text;
  v_audit_action text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'p18_mark_healed: admin role required';
    END IF;
  END IF;

  IF p_action NOT IN ('SUGGEST_KNOWN_SYSTEM_ENTRY','EMIT_GOVERNANCE_AUDIT','TRIGGER_QUALITY_GATE_RERUN') THEN
    RAISE EXCEPTION 'p18_mark_healed: action % not in whitelist', p_action;
  END IF;

  IF p_result_status NOT IN ('healed','rejected') THEN
    RAISE EXCEPTION 'p18_mark_healed: result_status must be healed|rejected';
  END IF;

  SELECT * INTO v_row FROM public.p18_idempotency_ledger
   WHERE idempotency_key = p_idempotency_key FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'p18_mark_healed: ledger entry % not found', p_idempotency_key;
  END IF;

  IF v_row.status <> 'heal_requested' THEN
    RAISE EXCEPTION 'p18_mark_healed: ledger must be in heal_requested, got %', v_row.status;
  END IF;

  v_new_status := p_result_status;
  v_audit_action := CASE WHEN p_result_status = 'healed'
                         THEN 'p18_bounded_heal_completed'
                         ELSE 'p18_bounded_heal_rejected' END;

  UPDATE public.p18_idempotency_ledger
     SET status      = v_new_status,
         updated_at  = now()
   WHERE idempotency_key = p_idempotency_key
   RETURNING * INTO v_row;

  PERFORM public.fn_emit_audit(
    v_audit_action,
    'governance',
    p_idempotency_key,
    p_result_status,
    jsonb_build_object(
      'drift_type', v_row.drift_type,
      'target_fingerprint', v_row.target_fingerprint,
      'policy_version', v_row.policy_version,
      'idempotency_key', p_idempotency_key,
      'requested_action', p_action,
      'result_status', p_result_status
    ),
    'p18_heal_executor',
    NULL
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_p18_mark_healed(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_p18_mark_healed(text,text,text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 4: admin_get_p18_ledger (read-only, no raw payloads)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_p18_ledger(
  p_limit      int  DEFAULT 100,
  p_status     text DEFAULT NULL,
  p_drift_type text DEFAULT NULL
)
RETURNS TABLE (
  idempotency_key    text,
  drift_type         text,
  trigger_source     text,
  target_fingerprint text,
  policy_version     text,
  time_bucket        text,
  status             text,
  severity           text,
  verdict            text,
  finding_count      int,
  matched_system_ids text[],
  allowed_actions    text[],
  last_action        text,
  action_reason      text,
  created_at         timestamptz,
  updated_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_get_p18_ledger: admin role required';
  END IF;

  RETURN QUERY
  SELECT l.idempotency_key, l.drift_type, l.trigger_source, l.target_fingerprint,
         l.policy_version, l.time_bucket, l.status, l.severity, l.verdict,
         l.finding_count, l.matched_system_ids, l.allowed_actions,
         l.last_action, l.action_reason, l.created_at, l.updated_at
  FROM public.p18_idempotency_ledger l
  WHERE (p_status IS NULL OR l.status = p_status)
    AND (p_drift_type IS NULL OR l.drift_type = p_drift_type)
  ORDER BY l.updated_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_p18_ledger(int,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_p18_ledger(int,text,text) TO authenticated, service_role;
