
CREATE TABLE IF NOT EXISTS public.ops_audit_write_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  trigger_source text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  violation_count bigint NOT NULL DEFAULT 1,
  sample_metadata jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_write_violations_key
  ON public.ops_audit_write_violations (action_type, COALESCE(trigger_source, ''));

CREATE INDEX IF NOT EXISTS idx_audit_write_violations_last_seen
  ON public.ops_audit_write_violations (last_seen DESC);

ALTER TABLE public.ops_audit_write_violations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_violations_admin_select" ON public.ops_audit_write_violations;
CREATE POLICY "audit_violations_admin_select"
  ON public.ops_audit_write_violations FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.trg_fn_audit_write_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_via_contract text;
  v_mode         text;
BEGIN
  v_via_contract := COALESCE(current_setting('audit.via_contract', true), '0');
  v_mode := COALESCE(current_setting('app.audit_strict', true), 'warn');

  IF v_via_contract = '1' THEN
    PERFORM set_config('audit.via_contract','0', true);
    RETURN NEW;
  END IF;

  IF v_mode = 'enforce' THEN
    RAISE EXCEPTION 'audit_contract_violation: direct INSERT into auto_heal_log forbidden (action_type=%); use public.fn_emit_audit()', NEW.action_type;
  END IF;

  BEGIN
    INSERT INTO public.ops_audit_write_violations (action_type, trigger_source, sample_metadata)
    VALUES (NEW.action_type, NEW.trigger_source, NEW.metadata)
    ON CONFLICT (action_type, COALESCE(trigger_source, ''))
    DO UPDATE SET
      violation_count = public.ops_audit_write_violations.violation_count + 1,
      last_seen = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RAISE WARNING 'audit_contract_violation (warn): direct INSERT auto_heal_log action_type=% bypassed fn_emit_audit', NEW.action_type;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_audit_write_violations()
RETURNS TABLE (
  action_type text,
  trigger_source text,
  violation_count bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  sample_metadata jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.action_type, v.trigger_source, v.violation_count, v.first_seen, v.last_seen, v.sample_metadata
  FROM public.ops_audit_write_violations v
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY v.violation_count DESC, v.last_seen DESC
$$;

REVOKE ALL ON FUNCTION public.admin_get_audit_write_violations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_write_violations() TO authenticated;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('audit_write_contract_violator_observed', ARRAY['action_type']::text[], 'audit_contract')
ON CONFLICT (action_type) DO NOTHING;
