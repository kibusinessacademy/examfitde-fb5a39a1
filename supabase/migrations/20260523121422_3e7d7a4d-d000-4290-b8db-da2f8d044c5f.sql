
-- certification_profiles: replace permissive authenticated SELECT with admin-only
DROP POLICY IF EXISTS certification_profiles_read_authenticated ON public.certification_profiles;
CREATE POLICY certification_profiles_admin_read ON public.certification_profiles
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- german_certification_master: drop public read; admin policy already exists
DROP POLICY IF EXISTS public_read_cert_master ON public.german_certification_master;

-- lesson_answer_keys: drop broad authenticated read (admin ALL policy covers admin reads)
DROP POLICY IF EXISTS "Authenticated users can read answer keys" ON public.lesson_answer_keys;

-- media_assets: drop public read (admin ALL policy covers admin reads)
DROP POLICY IF EXISTS pub_read ON public.media_assets;

-- oral_exam_session_templates: drop public read; add explicit admin SELECT
DROP POLICY IF EXISTS pub_read ON public.oral_exam_session_templates;
CREATE POLICY oral_exam_session_templates_admin_read ON public.oral_exam_session_templates
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- step_dag_edges: drop public read; add admin SELECT
DROP POLICY IF EXISTS pub_read ON public.step_dag_edges;
CREATE POLICY step_dag_edges_admin_read ON public.step_dag_edges
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
