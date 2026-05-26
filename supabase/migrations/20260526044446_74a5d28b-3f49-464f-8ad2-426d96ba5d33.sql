
-- ════════════════════════════════════════════════════════════════════
-- BK-Act-5.1 — Org Structure Foundation
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_key text NOT NULL,
  name text NOT NULL,
  city text,
  country text DEFAULT 'DE',
  region text,
  is_active boolean NOT NULL DEFAULT true,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, site_key)
);
CREATE INDEX IF NOT EXISTS idx_org_sites_org ON public.org_sites(org_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.org_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.org_sites(id) ON DELETE SET NULL,
  department_key text NOT NULL,
  name text NOT NULL,
  parent_department_id uuid REFERENCES public.org_departments(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, department_key)
);
CREATE INDEX IF NOT EXISTS idx_org_departments_org ON public.org_departments(org_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_org_departments_site ON public.org_departments(site_id) WHERE site_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.org_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.org_sites(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.org_departments(id) ON DELETE SET NULL,
  cohort_key text NOT NULL,
  name text NOT NULL,
  profession_key text,
  start_year integer,
  exam_window text,
  training_year integer,
  risk_band text CHECK (risk_band IS NULL OR risk_band IN ('low','medium','high','critical')),
  recovery_band text CHECK (recovery_band IS NULL OR recovery_band IN ('none','active','recovered')),
  is_active boolean NOT NULL DEFAULT true,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, cohort_key)
);
CREATE INDEX IF NOT EXISTS idx_org_cohorts_org ON public.org_cohorts(org_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_org_cohorts_profession ON public.org_cohorts(org_id, profession_key);
CREATE INDEX IF NOT EXISTS idx_org_cohorts_exam_window ON public.org_cohorts(org_id, exam_window);

CREATE TABLE IF NOT EXISTS public.org_reporting_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_key text NOT NULL,
  name text NOT NULL,
  unit_type text NOT NULL CHECK (unit_type IN ('site','department','cohort','profession','custom')),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, unit_key)
);

CREATE TABLE IF NOT EXISTS public.org_member_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  site_id uuid REFERENCES public.org_sites(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.org_departments(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES public.org_cohorts(id) ON DELETE CASCADE,
  reporting_unit_id uuid REFERENCES public.org_reporting_units(id) ON DELETE CASCADE,
  scoped_role text NOT NULL CHECK (scoped_role IN (
    'learner','ausbilder','standortleiter','bereichsleiter','hr','executive','manager_readonly'
  )),
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    site_id IS NOT NULL OR department_id IS NOT NULL
    OR cohort_id IS NOT NULL OR reporting_unit_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_oma_user ON public.org_member_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_oma_org ON public.org_member_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_oma_site ON public.org_member_assignments(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oma_dept ON public.org_member_assignments(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oma_cohort ON public.org_member_assignments(cohort_id) WHERE cohort_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_oma_primary_user_org
  ON public.org_member_assignments(user_id, org_id)
  WHERE is_primary;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_sites','org_departments','org_cohorts','org_reporting_units','org_member_assignments']
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS set_updated_at_%1$s ON public.%1$s;
      CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$s
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    $f$, t);
  END LOOP;
END $$;

ALTER TABLE public.org_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_reporting_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_member_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_has_org_management(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE org_id = _org AND user_id = _user
      AND status = 'active'
      AND role IN ('owner','admin','manager')
  );
$$;

DO $$ BEGIN EXECUTE 'CREATE POLICY org_sites_read ON public.org_sites FOR SELECT TO authenticated USING (is_org_member(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY org_sites_manage ON public.org_sites FOR ALL TO authenticated USING (fn_has_org_management(auth.uid(), org_id)) WITH CHECK (fn_has_org_management(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY org_departments_read ON public.org_departments FOR SELECT TO authenticated USING (is_org_member(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY org_departments_manage ON public.org_departments FOR ALL TO authenticated USING (fn_has_org_management(auth.uid(), org_id)) WITH CHECK (fn_has_org_management(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY org_cohorts_read ON public.org_cohorts FOR SELECT TO authenticated USING (is_org_member(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY org_cohorts_manage ON public.org_cohorts FOR ALL TO authenticated USING (fn_has_org_management(auth.uid(), org_id)) WITH CHECK (fn_has_org_management(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY org_runits_read ON public.org_reporting_units FOR SELECT TO authenticated USING (is_org_member(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY org_runits_manage ON public.org_reporting_units FOR ALL TO authenticated USING (fn_has_org_management(auth.uid(), org_id)) WITH CHECK (fn_has_org_management(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY oma_read_own ON public.org_member_assignments FOR SELECT TO authenticated USING (user_id = auth.uid() OR fn_has_org_management(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY oma_manage ON public.org_member_assignments FOR ALL TO authenticated USING (fn_has_org_management(auth.uid(), org_id)) WITH CHECK (fn_has_org_management(auth.uid(), org_id))'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.fn_org_user_scope(_user uuid, _org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_role text;
  v_sites uuid[]; v_depts uuid[]; v_cohorts uuid[]; v_units uuid[];
  v_scoped_roles text[];
  v_full boolean := false;
BEGIN
  SELECT role INTO v_role FROM org_memberships
   WHERE org_id=_org AND user_id=_user AND status='active' LIMIT 1;
  IF v_role IN ('owner','admin') THEN v_full := true; END IF;

  SELECT array_agg(DISTINCT site_id) FILTER (WHERE site_id IS NOT NULL),
         array_agg(DISTINCT department_id) FILTER (WHERE department_id IS NOT NULL),
         array_agg(DISTINCT cohort_id) FILTER (WHERE cohort_id IS NOT NULL),
         array_agg(DISTINCT reporting_unit_id) FILTER (WHERE reporting_unit_id IS NOT NULL),
         array_agg(DISTINCT scoped_role)
    INTO v_sites, v_depts, v_cohorts, v_units, v_scoped_roles
  FROM org_member_assignments
  WHERE org_id=_org AND user_id=_user
    AND (valid_until IS NULL OR valid_until > now());

  RETURN jsonb_build_object(
    'org_id', _org, 'user_id', _user,
    'membership_role', v_role,
    'has_full_org_scope', v_full,
    'scoped_roles', COALESCE(v_scoped_roles, ARRAY[]::text[]),
    'site_ids', COALESCE(v_sites, ARRAY[]::uuid[]),
    'department_ids', COALESCE(v_depts, ARRAY[]::uuid[]),
    'cohort_ids', COALESCE(v_cohorts, ARRAY[]::uuid[]),
    'reporting_unit_ids', COALESCE(v_units, ARRAY[]::uuid[])
  );
END $$;
REVOKE ALL ON FUNCTION public.fn_org_user_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_org_user_scope(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_can_view_site(_user uuid, _site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE
    WHEN s.org_id IS NULL THEN false
    WHEN fn_has_org_management(_user, s.org_id) THEN true
    WHEN EXISTS (
      SELECT 1 FROM org_member_assignments oma
      WHERE oma.user_id=_user AND oma.org_id=s.org_id AND oma.site_id=_site
        AND (oma.valid_until IS NULL OR oma.valid_until > now())
    ) THEN true ELSE false
  END FROM org_sites s WHERE s.id=_site;
$$;
REVOKE ALL ON FUNCTION public.fn_can_view_site(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_can_view_site(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_structure_list(_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT is_org_member(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'sites', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) FROM org_sites s WHERE s.org_id=_org_id AND s.is_active), '[]'::jsonb),
    'departments', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.name) FROM org_departments d WHERE d.org_id=_org_id AND d.is_active), '[]'::jsonb),
    'cohorts', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM org_cohorts c WHERE c.org_id=_org_id AND c.is_active), '[]'::jsonb),
    'reporting_units', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name) FROM org_reporting_units r WHERE r.org_id=_org_id AND r.is_active), '[]'::jsonb),
    'scope', fn_org_user_scope(auth.uid(), _org_id)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.org_structure_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_structure_list(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_site_upsert(
  _org_id uuid, _site_key text, _name text,
  _city text DEFAULT NULL, _region text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT fn_has_org_management(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  INSERT INTO org_sites(org_id, site_key, name, city, region)
  VALUES (_org_id, _site_key, _name, _city, _region)
  ON CONFLICT (org_id, site_key) DO UPDATE
    SET name=EXCLUDED.name, city=EXCLUDED.city, region=EXCLUDED.region, updated_at=now()
  RETURNING id INTO v_id;
  PERFORM fn_emit_audit('org_site_upserted', jsonb_build_object(
    'org_id', _org_id, 'site_id', v_id, 'site_key', _site_key, 'actor', auth.uid()
  ));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.org_site_upsert(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_site_upsert(uuid,text,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_cohort_upsert(
  _org_id uuid, _cohort_key text, _name text,
  _profession_key text DEFAULT NULL, _start_year integer DEFAULT NULL,
  _exam_window text DEFAULT NULL, _training_year integer DEFAULT NULL,
  _site_id uuid DEFAULT NULL, _department_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT fn_has_org_management(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  INSERT INTO org_cohorts(org_id, cohort_key, name, profession_key, start_year, exam_window, training_year, site_id, department_id)
  VALUES (_org_id, _cohort_key, _name, _profession_key, _start_year, _exam_window, _training_year, _site_id, _department_id)
  ON CONFLICT (org_id, cohort_key) DO UPDATE
    SET name=EXCLUDED.name, profession_key=EXCLUDED.profession_key,
        start_year=EXCLUDED.start_year, exam_window=EXCLUDED.exam_window,
        training_year=EXCLUDED.training_year, site_id=EXCLUDED.site_id,
        department_id=EXCLUDED.department_id, updated_at=now()
  RETURNING id INTO v_id;
  PERFORM fn_emit_audit('org_cohort_upserted', jsonb_build_object(
    'org_id', _org_id, 'cohort_id', v_id, 'cohort_key', _cohort_key, 'actor', auth.uid()
  ));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.org_cohort_upsert(uuid,text,text,text,integer,text,integer,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_cohort_upsert(uuid,text,text,text,integer,text,integer,uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_member_assignment_upsert(
  _org_id uuid, _user_id uuid, _scoped_role text,
  _site_id uuid DEFAULT NULL, _department_id uuid DEFAULT NULL,
  _cohort_id uuid DEFAULT NULL, _reporting_unit_id uuid DEFAULT NULL,
  _is_primary boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT fn_has_org_management(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _is_primary THEN
    UPDATE org_member_assignments SET is_primary=false
     WHERE org_id=_org_id AND user_id=_user_id AND is_primary=true;
  END IF;
  INSERT INTO org_member_assignments(
    org_id, user_id, scoped_role, site_id, department_id, cohort_id, reporting_unit_id, is_primary
  ) VALUES (
    _org_id, _user_id, _scoped_role, _site_id, _department_id, _cohort_id, _reporting_unit_id, _is_primary
  ) RETURNING id INTO v_id;
  PERFORM fn_emit_audit('org_member_assignment_created', jsonb_build_object(
    'org_id', _org_id, 'assignment_id', v_id, 'user_id', _user_id,
    'scoped_role', _scoped_role, 'actor', auth.uid()
  ));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.org_member_assignment_upsert(uuid,uuid,text,uuid,uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_member_assignment_upsert(uuid,uuid,text,uuid,uuid,uuid,uuid,boolean) TO authenticated, service_role;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES
  ('org_site_upserted', ARRAY['org_id','site_id','site_key','actor'], 'bk_act_5'),
  ('org_cohort_upserted', ARRAY['org_id','cohort_id','cohort_key','actor'], 'bk_act_5'),
  ('org_member_assignment_created', ARRAY['org_id','assignment_id','user_id','scoped_role','actor'], 'bk_act_5')
ON CONFLICT (action_type) DO NOTHING;
