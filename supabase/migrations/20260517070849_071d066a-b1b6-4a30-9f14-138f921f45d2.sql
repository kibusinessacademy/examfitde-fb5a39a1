-- Migration C: Audit Write Contract (warn-mode start)

-- 1) Registry
CREATE TABLE IF NOT EXISTS public.ops_audit_contract (
  action_type    text PRIMARY KEY,
  required_keys  text[] NOT NULL DEFAULT '{}',
  schema_version int NOT NULL DEFAULT 1,
  owner_module   text NOT NULL DEFAULT 'unknown',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_audit_contract ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit contract" ON public.ops_audit_contract;
CREATE POLICY "Admins read audit contract"
  ON public.ops_audit_contract FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

REVOKE ALL ON public.ops_audit_contract FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_audit_contract TO service_role;

-- 2) Seed: all distinct action_types from last 30 days, empty required_keys (baseline)
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
SELECT DISTINCT action_type, '{}'::text[], 'legacy_backfill'
FROM public.auto_heal_log
WHERE created_at > now() - interval '30 days'
  AND action_type IS NOT NULL
ON CONFLICT (action_type) DO NOTHING;

-- Seed: new action_types this contract introduces
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('audit_contract_violation', ARRAY['offending_action_type','reason'], 'audit_contract'),
  ('public_read_grants_applied', '{}', 'journey1_p0'),
  ('event_enum_extended', ARRAY['added_event'], 'journey1_p0'),
  ('checkout_redirect_missing_url', ARRAY['product_slug','source'], 'journey1_p0'),
  ('tracking_insert_failed', ARRAY['event_type','code'], 'journey1_p0'),
  ('catalog_visibility_drift_inspected', '{}', 'journey1_p0')
ON CONFLICT (action_type) DO NOTHING;

-- 3) SSOT writer
CREATE OR REPLACE FUNCTION public.fn_emit_audit(
  _action_type    text,
  _target_type    text  DEFAULT 'system',
  _target_id      text  DEFAULT NULL,
  _result_status  text  DEFAULT 'success',
  _payload        jsonb DEFAULT '{}'::jsonb,
  _trigger_source text  DEFAULT 'manual',
  _error_message  text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_required text[];
  v_missing  text[];
  v_id       uuid;
  v_key      text;
BEGIN
  IF _action_type IS NULL OR length(_action_type) = 0 THEN
    RAISE EXCEPTION 'fn_emit_audit: action_type is required';
  END IF;

  SELECT required_keys INTO v_required
  FROM public.ops_audit_contract
  WHERE action_type = _action_type;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_emit_audit: unknown action_type %, register it in ops_audit_contract first', _action_type
      USING HINT = 'INSERT INTO ops_audit_contract(action_type,required_keys,owner_module) VALUES (...)';
  END IF;

  -- Pflichtfeld-Check
  IF v_required IS NOT NULL AND array_length(v_required, 1) IS NOT NULL THEN
    v_missing := ARRAY[]::text[];
    FOREACH v_key IN ARRAY v_required LOOP
      IF NOT (_payload ? v_key) THEN
        v_missing := array_append(v_missing, v_key);
      END IF;
    END LOOP;
    IF array_length(v_missing,1) IS NOT NULL THEN
      RAISE EXCEPTION 'fn_emit_audit: action % missing required payload keys: %',
        _action_type, array_to_string(v_missing, ',');
    END IF;
  END IF;

  -- Sessions-Flag setzen, damit Trigger uns durchwinkt
  PERFORM set_config('audit.via_contract','1', true);

  INSERT INTO public.auto_heal_log (
    action_type, target_type, target_id, result_status,
    metadata, trigger_source, error_message
  ) VALUES (
    _action_type, COALESCE(_target_type,'system'), _target_id,
    COALESCE(_result_status,'success'),
    COALESCE(_payload,'{}'::jsonb), COALESCE(_trigger_source,'manual'),
    _error_message
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.fn_emit_audit(text,text,text,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_emit_audit(text,text,text,text,jsonb,text,text)
  TO authenticated, service_role;

-- 4) Warn-mode guard trigger
CREATE OR REPLACE FUNCTION public.trg_fn_audit_write_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_via_contract text;
  v_mode         text;
BEGIN
  v_via_contract := COALESCE(current_setting('audit.via_contract', true), '0');
  v_mode := COALESCE(current_setting('app.audit_strict', true), 'warn');

  IF v_via_contract = '1' THEN
    -- Reset für nächsten Insert in dieser Session
    PERFORM set_config('audit.via_contract','0', true);
    RETURN NEW;
  END IF;

  IF v_mode = 'enforce' THEN
    RAISE EXCEPTION 'audit_contract_violation: direct INSERT into auto_heal_log forbidden (action_type=%); use public.fn_emit_audit()', NEW.action_type;
  ELSE
    RAISE WARNING 'audit_contract_violation (warn): direct INSERT auto_heal_log action_type=% bypassed fn_emit_audit', NEW.action_type;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_write_contract ON public.auto_heal_log;
CREATE TRIGGER trg_audit_write_contract
  BEFORE INSERT ON public.auto_heal_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_audit_write_contract();

-- 5) Smoke: 1 ok + 3 hard-fail
DO $$
DECLARE v_id uuid; v_caught int := 0;
BEGIN
  -- (a) valid
  v_id := public.fn_emit_audit(
    'public_read_grants_applied','system',NULL,'success',
    '{"smoke":true}'::jsonb,'smoke_test',NULL);
  IF v_id IS NULL THEN RAISE EXCEPTION 'smoke a: valid call returned null'; END IF;
  DELETE FROM public.auto_heal_log WHERE id = v_id;

  -- (b) unknown action_type
  BEGIN
    PERFORM public.fn_emit_audit('___nonexistent_action___','system',NULL,'success','{}'::jsonb,'smoke_test',NULL);
    RAISE EXCEPTION 'smoke b: unknown action_type did not raise';
  EXCEPTION WHEN OTHERS THEN v_caught := v_caught + 1;
  END;

  -- (c) missing required payload key (checkout_redirect_missing_url needs product_slug + source)
  BEGIN
    PERFORM public.fn_emit_audit('checkout_redirect_missing_url','system',NULL,'error','{}'::jsonb,'smoke_test','x');
    RAISE EXCEPTION 'smoke c: missing key did not raise';
  EXCEPTION WHEN OTHERS THEN v_caught := v_caught + 1;
  END;

  -- (d) null action_type
  BEGIN
    PERFORM public.fn_emit_audit(NULL,'system',NULL,'success','{}'::jsonb,'smoke_test',NULL);
    RAISE EXCEPTION 'smoke d: null action_type did not raise';
  EXCEPTION WHEN OTHERS THEN v_caught := v_caught + 1;
  END;

  IF v_caught <> 3 THEN
    RAISE EXCEPTION 'audit-contract smoke failed: expected 3 hard fails, got %', v_caught;
  END IF;
END $$;

-- 6) Success audit via the new contract
SELECT public.fn_emit_audit(
  'public_read_grants_applied','system',NULL,'success',
  jsonb_build_object('migration','audit_write_contract_v1','mode','warn','seeded_actions',(SELECT COUNT(*) FROM public.ops_audit_contract)),
  'migration', NULL);