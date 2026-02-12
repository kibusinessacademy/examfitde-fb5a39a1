
-- =========================================
-- Course Studio v2 - SSOT Package Plan + Outputs + Locks
-- =========================================

-- SSOT Plan: Councils entscheiden, was ins Paket kommt
CREATE TABLE IF NOT EXISTS public.course_package_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  decided_by jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_package_plans_package_id
  ON public.course_package_plans(package_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_package_plans_one_approved
  ON public.course_package_plans(package_id)
  WHERE status = 'approved';

-- Builder outputs
CREATE TABLE IF NOT EXISTS public.course_package_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  output_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_package_outputs_key
  ON public.course_package_outputs(package_id, output_key);

-- Locks (package-level) - prevents double-run
CREATE TABLE IF NOT EXISTS public.course_package_locks (
  package_id uuid PRIMARY KEY REFERENCES public.course_packages(id) ON DELETE CASCADE,
  locked_at timestamptz NOT NULL DEFAULT now()
);

-- RLS deny-by-default
ALTER TABLE public.course_package_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_package_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_package_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_course_package_plans" ON public.course_package_plans
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_all_course_package_outputs" ON public.course_package_outputs
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_all_course_package_locks" ON public.course_package_locks
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
