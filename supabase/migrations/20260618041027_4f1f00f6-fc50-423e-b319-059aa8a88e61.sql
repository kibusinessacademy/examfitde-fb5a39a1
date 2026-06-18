
-- =============================================================
-- SSOT Inviolable Guardrail — Phase 1
-- =============================================================

-- 1) Config: which domains are enforced
CREATE TABLE IF NOT EXISTS public.ssot_guard_config (
  domain text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  enforce_mode text NOT NULL DEFAULT 'block' CHECK (enforce_mode IN ('block','warn','off')),
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.ssot_guard_config TO authenticated;
GRANT ALL ON public.ssot_guard_config TO service_role;
ALTER TABLE public.ssot_guard_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read config" ON public.ssot_guard_config
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service writes config" ON public.ssot_guard_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.ssot_guard_config(domain, description) VALUES
  ('roles_user_roles_only',  'Roles must live in user_roles table; profiles/companies must not gain a role column.'),
  ('audit_emit_only',         'Audit tables write-only via fn_emit_audit() or explicit bypass GUC.'),
  ('pipeline_step_order',     'Pipeline step order changes must follow STEP_KEYS contract.'),
  ('naming_allowlist',        'New public objects must appear in ssot-allowlist / system_contract_registry.')
ON CONFLICT (domain) DO NOTHING;

-- 2) Violation log (also tracks overrides)
CREATE TABLE IF NOT EXISTS public.ssot_guard_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  kind text NOT NULL,                -- 'violation' | 'override_grant' | 'override_use'
  actor_role text,
  actor_uid uuid,
  object_name text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ssot_guard_violations TO authenticated;
GRANT ALL ON public.ssot_guard_violations TO service_role;
ALTER TABLE public.ssot_guard_violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read violations" ON public.ssot_guard_violations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service writes violations" ON public.ssot_guard_violations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ssot_guard_viol_created ON public.ssot_guard_violations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssot_guard_viol_domain ON public.ssot_guard_violations(domain, created_at DESC);

-- 3) Helper: is domain currently enforced (considers bypass GUC)
CREATE OR REPLACE FUNCTION public.fn_ssot_guard_active(_domain text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_mode text;
  v_bypass text;
BEGIN
  BEGIN
    v_bypass := current_setting('app.ssot_bypass', true);
  EXCEPTION WHEN OTHERS THEN v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    RETURN false;
  END IF;
  SELECT enabled, enforce_mode INTO v_enabled, v_mode
  FROM public.ssot_guard_config WHERE domain = _domain;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN v_enabled AND v_mode = 'block';
END;
$$;

-- 4) Roles SSOT: block role column on profiles/companies
CREATE OR REPLACE FUNCTION public.fn_ssot_guard_roles_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  has_role_col boolean;
BEGIN
  IF NOT public.fn_ssot_guard_active('roles_user_roles_only') THEN
    RETURN;
  END IF;
  FOR r IN SELECT * FROM pg_event_trigger_ddl_commands()
           WHERE schema_name = 'public'
             AND object_type IN ('table','table column')
  LOOP
    IF r.object_identity ILIKE 'public.profiles%' OR r.object_identity ILIKE 'public.companies%' THEN
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name = split_part(replace(r.object_identity,'public.',''),'.',1)
          AND column_name IN ('role','roles','user_role')
      ) INTO has_role_col;
      IF has_role_col THEN
        INSERT INTO public.ssot_guard_violations(domain, kind, object_name, detail, blocked)
        VALUES ('roles_user_roles_only','violation', r.object_identity,
                jsonb_build_object('command_tag', r.command_tag), true);
        RAISE EXCEPTION 'SSOT-GUARD [roles_user_roles_only]: role column forbidden on %, use public.user_roles', r.object_identity
          USING HINT = 'Drop the role column and migrate to user_roles + has_role().';
      END IF;
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS evt_ssot_guard_roles;
CREATE EVENT TRIGGER evt_ssot_guard_roles
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE','ALTER TABLE')
  EXECUTE FUNCTION public.fn_ssot_guard_roles_ddl();

-- 5) Audit SSOT: only fn_emit_audit (or bypass) may write to ops_audit_contract
CREATE OR REPLACE FUNCTION public.fn_ssot_guard_audit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller text;
  v_via_emit boolean := false;
BEGIN
  IF NOT public.fn_ssot_guard_active('audit_emit_only') THEN
    RETURN NEW;
  END IF;
  -- Allow when called inside fn_emit_audit (check call stack via GUC marker)
  BEGIN
    v_caller := current_setting('app.ssot_audit_writer', true);
  EXCEPTION WHEN OTHERS THEN v_caller := NULL;
  END;
  IF v_caller = 'fn_emit_audit' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.ssot_guard_violations(domain, kind, object_name, actor_role, detail, blocked)
  VALUES ('audit_emit_only','violation','public.ops_audit_contract', current_user,
          jsonb_build_object('op', TG_OP), true);
  RAISE EXCEPTION 'SSOT-GUARD [audit_emit_only]: direct writes to ops_audit_contract are forbidden'
    USING HINT = 'Use public.fn_emit_audit() instead.';
END;
$$;

DROP TRIGGER IF EXISTS trg_ssot_guard_audit_write ON public.ops_audit_contract;
CREATE TRIGGER trg_ssot_guard_audit_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.ops_audit_contract
  FOR EACH ROW EXECUTE FUNCTION public.fn_ssot_guard_audit_write();

-- 6) Admin Override RPC (time-bounded, audited)
CREATE OR REPLACE FUNCTION public.admin_ssot_override(
  _domain text,
  _reason text,
  _ttl_minutes integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 10 THEN
    RAISE EXCEPTION 'reason required (>=10 chars)';
  END IF;
  IF _ttl_minutes < 1 OR _ttl_minutes > 120 THEN
    RAISE EXCEPTION 'ttl_minutes must be 1..120';
  END IF;
  INSERT INTO public.ssot_guard_violations(domain, kind, actor_uid, actor_role, detail, blocked)
  VALUES (_domain,'override_grant', v_uid, 'admin',
          jsonb_build_object('reason', _reason, 'ttl_minutes', _ttl_minutes), false);
  RETURN jsonb_build_object(
    'ok', true,
    'domain', _domain,
    'expires_at', now() + make_interval(mins => _ttl_minutes),
    'instruction', 'Run within the same session: SELECT set_config(''app.ssot_bypass'',''on'',true);'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_ssot_override(text,text,integer) TO authenticated;

-- 7) Status view
CREATE OR REPLACE VIEW public.v_admin_ssot_guard_status AS
SELECT
  c.domain,
  c.enabled,
  c.enforce_mode,
  c.description,
  (SELECT count(*) FROM public.ssot_guard_violations v
     WHERE v.domain = c.domain AND v.kind='violation'
       AND v.created_at > now() - interval '7 days') AS violations_7d,
  (SELECT count(*) FROM public.ssot_guard_violations v
     WHERE v.domain = c.domain AND v.kind='override_grant'
       AND v.created_at > now() - interval '7 days') AS overrides_7d,
  (SELECT max(v.created_at) FROM public.ssot_guard_violations v
     WHERE v.domain = c.domain AND v.kind='violation') AS last_violation_at,
  c.updated_at
FROM public.ssot_guard_config c
ORDER BY c.domain;
GRANT SELECT ON public.v_admin_ssot_guard_status TO authenticated;

-- 8) Toggle RPC
CREATE OR REPLACE FUNCTION public.admin_ssot_guard_toggle(_domain text, _enabled boolean, _mode text DEFAULT 'block')
RETURNS public.ssot_guard_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ssot_guard_config;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _mode NOT IN ('block','warn','off') THEN
    RAISE EXCEPTION 'invalid mode';
  END IF;
  UPDATE public.ssot_guard_config
     SET enabled=_enabled, enforce_mode=_mode, updated_at=now(), updated_by=auth.uid()
   WHERE domain=_domain
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown domain %', _domain; END IF;
  INSERT INTO public.ssot_guard_violations(domain, kind, actor_uid, actor_role, detail, blocked)
  VALUES (_domain,'config_change', auth.uid(),'admin',
          jsonb_build_object('enabled',_enabled,'mode',_mode), false);
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_ssot_guard_toggle(text,boolean,text) TO authenticated;
