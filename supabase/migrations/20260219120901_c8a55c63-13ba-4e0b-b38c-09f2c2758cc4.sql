
-- Create missing RPCs used by admin views

-- 1) get_curriculum_lf_counts – used by CurriculumHealthDashboard
CREATE OR REPLACE FUNCTION public.get_curriculum_lf_counts()
RETURNS TABLE(curriculum_id uuid, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT curriculum_id, COUNT(*) as count
  FROM learning_fields
  WHERE curriculum_id IS NOT NULL
  GROUP BY curriculum_id;
$$;

-- 2) get_curriculum_competency_counts – used by CurriculumHealthDashboard
CREATE OR REPLACE FUNCTION public.get_curriculum_competency_counts()
RETURNS TABLE(curriculum_id uuid, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lf.curriculum_id, COUNT(c.id) as count
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id IS NOT NULL
  GROUP BY lf.curriculum_id;
$$;

-- 3) count_curricula_by_status – used by OpsPage
CREATE OR REPLACE FUNCTION public.count_curricula_by_status()
RETURNS TABLE(status text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status, COUNT(*) as count
  FROM curricula
  GROUP BY status;
$$;

-- 4) count_packages_by_status – used by OpsPage
CREATE OR REPLACE FUNCTION public.count_packages_by_status()
RETURNS TABLE(status text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status, COUNT(*) as count
  FROM course_packages
  GROUP BY status;
$$;
