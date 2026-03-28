
CREATE TABLE public.admin_course_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  tested_by uuid NOT NULL,
  test_status text NOT NULL,
  notes text,
  issue_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_course_test_runs_package ON public.admin_course_test_runs(package_id, created_at DESC);
CREATE INDEX idx_admin_course_test_runs_tester ON public.admin_course_test_runs(tested_by, created_at DESC);

ALTER TABLE public.admin_course_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read admin_course_test_runs"
  ON public.admin_course_test_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

CREATE POLICY "Admins can insert admin_course_test_runs"
  ON public.admin_course_test_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin') AND tested_by = auth.uid());

GRANT ALL ON public.admin_course_test_runs TO service_role;

CREATE OR REPLACE FUNCTION public.record_admin_course_test_run(
  p_package_id uuid, p_curriculum_id uuid, p_test_status text,
  p_notes text DEFAULT NULL, p_issue_codes text[] DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user_id AND ur.role = 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  INSERT INTO public.admin_course_test_runs (package_id, curriculum_id, tested_by, test_status, notes, issue_codes)
  VALUES (p_package_id, p_curriculum_id, v_user_id, p_test_status, p_notes, COALESCE(p_issue_codes, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.record_admin_course_test_run(uuid, uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_admin_course_test_run(uuid, uuid, text, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_admin_course_test_run_latest AS
SELECT DISTINCT ON (r.package_id)
  r.package_id, r.curriculum_id, r.tested_by, r.test_status, r.notes, r.issue_codes, r.created_at
FROM public.admin_course_test_runs r
ORDER BY r.package_id, r.created_at DESC;

CREATE OR REPLACE FUNCTION public.get_admin_course_test_run_latest()
RETURNS TABLE (package_id uuid, curriculum_id uuid, tested_by uuid, test_status text, notes text, issue_codes text[], created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.package_id, l.curriculum_id, l.tested_by, l.test_status, l.notes, l.issue_codes, l.created_at
  FROM public.v_admin_course_test_run_latest l ORDER BY l.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_course_test_run_latest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_course_test_run_latest() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_course_test_run_history(p_package_id uuid)
RETURNS TABLE (id uuid, package_id uuid, curriculum_id uuid, tested_by uuid, test_status text, notes text, issue_codes text[], created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.package_id, r.curriculum_id, r.tested_by, r.test_status, r.notes, r.issue_codes, r.created_at
  FROM public.admin_course_test_runs r WHERE r.package_id = p_package_id ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_course_test_run_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_course_test_run_history(uuid) TO authenticated, service_role;
