
-- =========================================
-- Course Studio v2: Security + RPC helpers
-- Teil 2/2
-- =========================================

-- RLS aktivieren (deny-by-default)
ALTER TABLE public.course_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_package_build_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_sessions ENABLE ROW LEVEL SECURITY;

-- Deny-all Policies für anon + authenticated (Service Role bypassed RLS)
DO $$
BEGIN
  -- course_packages
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='course_packages' AND policyname='deny_all_course_packages'
  ) THEN
    CREATE POLICY "deny_all_course_packages" ON public.course_packages
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  -- build_steps
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='course_package_build_steps' AND policyname='deny_all_course_package_build_steps'
  ) THEN
    CREATE POLICY "deny_all_course_package_build_steps" ON public.course_package_build_steps
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  -- council_sessions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='council_sessions' AND policyname='deny_all_council_sessions'
  ) THEN
    CREATE POLICY "deny_all_council_sessions" ON public.council_sessions
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

-- Drop conflicting admin policies if they exist
DROP POLICY IF EXISTS "admin_course_packages_all" ON public.course_packages;
DROP POLICY IF EXISTS "admin_course_package_build_steps_all" ON public.course_package_build_steps;
DROP POLICY IF EXISTS "admin_council_sessions_all" ON public.council_sessions;

-- =========================================================
-- RPCs (SECURITY DEFINER + search_path) für Admin UI
-- =========================================================

-- 1) Package upsert by certification_id
CREATE OR REPLACE FUNCTION public.upsert_course_package(
  p_certification_id uuid,
  p_course_id uuid DEFAULT NULL
) RETURNS public.course_packages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.course_packages;
BEGIN
  SELECT * INTO v_pkg
  FROM public.course_packages
  WHERE certification_id = p_certification_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pkg.id IS NULL THEN
    INSERT INTO public.course_packages (certification_id, course_id, status)
    VALUES (p_certification_id, p_course_id, 'planning')
    RETURNING * INTO v_pkg;
  ELSE
    IF p_course_id IS NOT NULL AND (v_pkg.course_id IS NULL OR v_pkg.course_id <> p_course_id) THEN
      UPDATE public.course_packages
        SET course_id = p_course_id
      WHERE id = v_pkg.id
      RETURNING * INTO v_pkg;
    END IF;
  END IF;

  RETURN v_pkg;
END $$;

REVOKE ALL ON FUNCTION public.upsert_course_package(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_course_package(uuid, uuid) TO authenticated;

-- 2) Council Approval setzen
CREATE OR REPLACE FUNCTION public.set_course_package_council_approved(
  p_package_id uuid,
  p_approved boolean
) RETURNS public.course_packages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.course_packages;
BEGIN
  UPDATE public.course_packages
    SET council_approved = p_approved,
        status = CASE WHEN p_approved THEN 'building' ELSE 'council_review' END
  WHERE id = p_package_id
  RETURNING * INTO v_pkg;

  RETURN v_pkg;
END $$;

REVOKE ALL ON FUNCTION public.set_course_package_council_approved(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_course_package_council_approved(uuid, boolean) TO authenticated;

-- 3) Step Status updaten (für Orchestrator)
CREATE OR REPLACE FUNCTION public.update_course_package_step(
  p_package_id uuid,
  p_step_key text,
  p_status text,
  p_log jsonb DEFAULT NULL
) RETURNS public.course_package_build_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step public.course_package_build_steps;
BEGIN
  INSERT INTO public.course_package_build_steps (package_id, step_key, status, started_at, log)
  VALUES (p_package_id, p_step_key, p_status, CASE WHEN p_status='running' THEN now() ELSE NULL END, COALESCE(p_log, '{}'::jsonb))
  ON CONFLICT (package_id, step_key)
  DO UPDATE SET
    status = EXCLUDED.status,
    started_at = CASE WHEN EXCLUDED.status='running' THEN now() ELSE public.course_package_build_steps.started_at END,
    finished_at = CASE WHEN EXCLUDED.status IN ('done','failed') THEN now() ELSE public.course_package_build_steps.finished_at END,
    log = CASE WHEN EXCLUDED.log IS NULL THEN public.course_package_build_steps.log ELSE EXCLUDED.log END
  RETURNING * INTO v_step;

  RETURN v_step;
END $$;

REVOKE ALL ON FUNCTION public.update_course_package_step(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_course_package_step(uuid, text, text, jsonb) TO authenticated;
