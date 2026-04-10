
-- ============================================================
-- BILDUNGSPLATTFORM-EVOLUTION: VOLLSTÄNDIGE MIGRATION
-- ============================================================

-- 1. ORGANISATIONS-TYPEN ERWEITERN
-- org_type ist TEXT — wir fügen einen CHECK-Constraint hinzu
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS chk_org_type;

ALTER TABLE public.organizations
  ADD CONSTRAINT chk_org_type CHECK (
    org_type IN ('COMPANY', 'SCHOOL', 'UNIVERSITY', 'IHK', 'HWK', 'PARTNER_AGENCY', 'PARTNER_AFFILIATE')
  );

-- Hierarchische Org-Beziehung (z.B. Filiale → Zentrale)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS parent_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 2. MITGLIEDSCHAFTS-ROLLEN ERWEITERN
-- role ist TEXT — wir fügen einen CHECK-Constraint hinzu
ALTER TABLE public.org_memberships
  DROP CONSTRAINT IF EXISTS chk_membership_role;

ALTER TABLE public.org_memberships
  ADD CONSTRAINT chk_membership_role CHECK (
    role IN (
      'OWNER', 'ADMIN', 'MANAGER', 'LEARNER', 'IT_ADMIN', 'BILLING', 'REPORT_VIEWER',
      'INSTRUCTOR', 'SCHOOL_ADMIN', 'IHK_ADMIN', 'HWK_ADMIN'
    )
  );

-- 3. SCHOOL_CLASSES
CREATE TABLE IF NOT EXISTS public.school_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  name text NOT NULL,
  grade_year text,                -- z.B. "2025/26", "Klasse 10a"
  academic_year text,             -- z.B. "2025-2026"
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'planned')),
  metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_classes_org ON public.school_classes(org_id);
CREATE INDEX IF NOT EXISTS idx_school_classes_curriculum ON public.school_classes(curriculum_id);

ALTER TABLE public.school_classes ENABLE ROW LEVEL SECURITY;

-- 4. CLASS_MEMBERSHIPS
CREATE TABLE IF NOT EXISTS public.class_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'instructor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'graduated')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_class_memberships_user ON public.class_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_class_memberships_class ON public.class_memberships(class_id);

ALTER TABLE public.class_memberships ENABLE ROW LEVEL SECURITY;

-- 5. INSTRUCTOR_ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.instructor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  class_id uuid REFERENCES public.school_classes(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'instructor' CHECK (role IN ('instructor', 'lead_instructor', 'examiner')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id, curriculum_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_instructor_assignments_org ON public.instructor_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_instructor_assignments_user ON public.instructor_assignments(user_id);

ALTER TABLE public.instructor_assignments ENABLE ROW LEVEL SECURITY;

-- 6. ORG_LINKS (operative Verknüpfungen)
CREATE TABLE IF NOT EXISTS public.org_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_a_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_b_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (
    link_type IN (
      'company_school',       -- Ausbildungsbetrieb ↔ Berufsschule
      'school_ihk',           -- Berufsschule ↔ IHK
      'school_hwk',           -- Berufsschule ↔ HWK
      'company_ihk',          -- Unternehmen ↔ IHK
      'company_hwk',          -- Unternehmen ↔ HWK
      'university_company',   -- Duales Studium
      'subsidiary'            -- Tochterunternehmen
    )
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'inactive')),
  metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_a_id, org_b_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_org_links_a ON public.org_links(org_a_id);
CREATE INDEX IF NOT EXISTS idx_org_links_b ON public.org_links(org_b_id);

ALTER TABLE public.org_links ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Helper: Check if user has management role in an org
CREATE OR REPLACE FUNCTION public.fn_has_org_management_role(
  p_user_id uuid,
  p_org_id uuid,
  p_roles text[] DEFAULT ARRAY['OWNER', 'ADMIN', 'MANAGER', 'SCHOOL_ADMIN', 'IT_ADMIN', 'IHK_ADMIN', 'HWK_ADMIN']
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships
    WHERE user_id = p_user_id
      AND org_id = p_org_id
      AND role = ANY(p_roles)
      AND status = 'active'
  )
$$;

-- SCHOOL_CLASSES policies
CREATE POLICY "Org admins can manage classes"
  ON public.school_classes FOR ALL
  USING (public.fn_has_org_management_role(auth.uid(), org_id))
  WITH CHECK (public.fn_has_org_management_role(auth.uid(), org_id));

CREATE POLICY "Instructors can view assigned classes"
  ON public.school_classes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.instructor_assignments ia
      WHERE ia.class_id = school_classes.id
        AND ia.user_id = auth.uid()
        AND ia.status = 'active'
    )
  );

CREATE POLICY "Platform admins full access to classes"
  ON public.school_classes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- CLASS_MEMBERSHIPS policies
CREATE POLICY "Class members can view own membership"
  ON public.class_memberships FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins can manage class memberships"
  ON public.class_memberships FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.school_classes sc
      WHERE sc.id = class_memberships.class_id
        AND public.fn_has_org_management_role(auth.uid(), sc.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.school_classes sc
      WHERE sc.id = class_memberships.class_id
        AND public.fn_has_org_management_role(auth.uid(), sc.org_id)
    )
  );

CREATE POLICY "Platform admins full access to class memberships"
  ON public.class_memberships FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- INSTRUCTOR_ASSIGNMENTS policies
CREATE POLICY "Instructors can view own assignments"
  ON public.instructor_assignments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins can manage instructor assignments"
  ON public.instructor_assignments FOR ALL
  USING (public.fn_has_org_management_role(auth.uid(), org_id))
  WITH CHECK (public.fn_has_org_management_role(auth.uid(), org_id));

CREATE POLICY "Platform admins full access to instructor assignments"
  ON public.instructor_assignments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ORG_LINKS policies
CREATE POLICY "Linked org admins can view links"
  ON public.org_links FOR SELECT
  USING (
    public.fn_has_org_management_role(auth.uid(), org_a_id)
    OR public.fn_has_org_management_role(auth.uid(), org_b_id)
  );

CREATE POLICY "Org admins can create links"
  ON public.org_links FOR INSERT
  WITH CHECK (
    public.fn_has_org_management_role(auth.uid(), org_a_id)
  );

CREATE POLICY "Org admins can update own links"
  ON public.org_links FOR UPDATE
  USING (public.fn_has_org_management_role(auth.uid(), org_a_id));

CREATE POLICY "Org admins can delete own links"
  ON public.org_links FOR DELETE
  USING (public.fn_has_org_management_role(auth.uid(), org_a_id));

CREATE POLICY "Platform admins full access to org links"
  ON public.org_links FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- RPCs: SCHOOL DASHBOARD
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_school_dashboard(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Verify caller has access
  IF NOT fn_has_org_management_role(auth.uid(), p_org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'SCHOOL_ADMIN']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'org', (SELECT jsonb_build_object('id', id, 'name', name, 'org_type', org_type) FROM organizations WHERE id = p_org_id),
    'classes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sc.id,
        'name', sc.name,
        'grade_year', sc.grade_year,
        'academic_year', sc.academic_year,
        'status', sc.status,
        'student_count', (SELECT count(*) FROM class_memberships cm WHERE cm.class_id = sc.id AND cm.role = 'student' AND cm.status = 'active'),
        'instructor_count', (SELECT count(*) FROM class_memberships cm WHERE cm.class_id = sc.id AND cm.role = 'instructor' AND cm.status = 'active'),
        'curriculum_id', sc.curriculum_id
      ))
      FROM school_classes sc WHERE sc.org_id = p_org_id AND sc.status = 'active'
    ), '[]'::jsonb),
    'total_students', (
      SELECT count(DISTINCT cm.user_id)
      FROM class_memberships cm
      JOIN school_classes sc ON sc.id = cm.class_id
      WHERE sc.org_id = p_org_id AND cm.role = 'student' AND cm.status = 'active'
    ),
    'total_instructors', (
      SELECT count(DISTINCT ia.user_id)
      FROM instructor_assignments ia
      WHERE ia.org_id = p_org_id AND ia.status = 'active'
    ),
    'linked_orgs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', CASE WHEN ol.org_a_id = p_org_id THEN ol.org_b_id ELSE ol.org_a_id END,
        'name', CASE WHEN ol.org_a_id = p_org_id THEN ob.name ELSE oa.name END,
        'type', CASE WHEN ol.org_a_id = p_org_id THEN ob.org_type ELSE oa.org_type END,
        'link_type', ol.link_type
      ))
      FROM org_links ol
      LEFT JOIN organizations oa ON oa.id = ol.org_a_id
      LEFT JOIN organizations ob ON ob.id = ol.org_b_id
      WHERE (ol.org_a_id = p_org_id OR ol.org_b_id = p_org_id) AND ol.status = 'active'
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- RPCs: INSTITUTION ANALYTICS (IHK/HWK)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_institution_analytics(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_org_type text;
BEGIN
  -- Verify caller has IHK/HWK admin access
  IF NOT fn_has_org_management_role(auth.uid(), p_org_id, ARRAY['OWNER', 'ADMIN', 'IHK_ADMIN', 'HWK_ADMIN']) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT org_type INTO v_org_type FROM organizations WHERE id = p_org_id;

  SELECT jsonb_build_object(
    'org', jsonb_build_object('id', p_org_id, 'org_type', v_org_type),
    'linked_schools', (
      SELECT count(DISTINCT CASE WHEN ol.org_a_id = p_org_id THEN ol.org_b_id ELSE ol.org_a_id END)
      FROM org_links ol
      WHERE (ol.org_a_id = p_org_id OR ol.org_b_id = p_org_id)
        AND ol.link_type IN ('school_ihk', 'school_hwk')
        AND ol.status = 'active'
    ),
    'linked_companies', (
      SELECT count(DISTINCT CASE WHEN ol.org_a_id = p_org_id THEN ol.org_b_id ELSE ol.org_a_id END)
      FROM org_links ol
      WHERE (ol.org_a_id = p_org_id OR ol.org_b_id = p_org_id)
        AND ol.link_type IN ('company_ihk', 'company_hwk')
        AND ol.status = 'active'
    ),
    'total_learners', (
      SELECT count(DISTINCT om.user_id)
      FROM org_links ol
      JOIN org_memberships om ON om.org_id = (CASE WHEN ol.org_a_id = p_org_id THEN ol.org_b_id ELSE ol.org_a_id END)
      WHERE (ol.org_a_id = p_org_id OR ol.org_b_id = p_org_id)
        AND ol.status = 'active'
        AND om.role = 'LEARNER'
        AND om.status = 'active'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_school_classes_updated_at
  BEFORE UPDATE ON public.school_classes
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_class_memberships_updated_at
  BEFORE UPDATE ON public.class_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_instructor_assignments_updated_at
  BEFORE UPDATE ON public.instructor_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_org_links_updated_at
  BEFORE UPDATE ON public.org_links
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
