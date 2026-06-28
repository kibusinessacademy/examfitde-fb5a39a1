-- AUDIT.SSOT.OVERLOADS.1
-- Canonical: public.fn_emit_audit(text,text,text,text,jsonb,text,text)
-- Canonical already exposes DEFAULTs on args 2..7, so any positional call
-- with 3..7 args resolves natively. Named-arg calls also resolve natively.
-- The ONLY shape the resolver cannot reach is the 2-arg shortform
--   fn_emit_audit(text, jsonb)
-- because it would bind jsonb to _target_type text (type mismatch).
-- We add ONE thin SQL adapter for that shape. Adding a 5-arg overload would
-- collide with canonical via DEFAULTs (see no-ambiguous-pg-overloads-v1).

CREATE OR REPLACE FUNCTION public.fn_emit_audit(
  _action_type text,
  _payload jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.fn_emit_audit(
    _action_type        := _action_type,
    _target_type        := 'system',
    _target_id          := NULL,
    _result_status      := 'success',
    _payload            := COALESCE(_payload, '{}'::jsonb),
    _trigger_source     := 'cron',
    _error_message      := NULL
  );
$$;

COMMENT ON FUNCTION public.fn_emit_audit(text, jsonb) IS
  'AUDIT.SSOT.OVERLOADS.1 adapter — delegates to canonical 7-arg fn_emit_audit. No logic here. See .lovable/memory/constraints/no-ambiguous-pg-overloads-v1.md';

REVOKE ALL ON FUNCTION public.fn_emit_audit(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_emit_audit(text, jsonb) TO authenticated, service_role;

-- Smoke: the adapter must route through canonical without raising,
-- using an already-registered action_type from the failing cron.
DO $smoke$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.fn_emit_audit(
    'policy_mutation_watchdog_decision',
    jsonb_build_object(
      'versions_scanned',     0,
      'rollbacks_triggered',  0,
      'suspect_versions',     '[]'::jsonb,
      'lookback_hours',       1,
      'min_delta_drop',       0,
      'smoke',                'AUDIT.SSOT.OVERLOADS.1'
    )
  );
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'AUDIT.SSOT.OVERLOADS.1 smoke failed (id=NULL)';
  END IF;
END
$smoke$;