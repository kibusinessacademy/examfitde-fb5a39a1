CREATE OR REPLACE FUNCTION public.fn_packages_needing_variant_inventory(p_limit int DEFAULT 20)
RETURNS TABLE(package_id uuid, curriculum_id uuid) 
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT cp.id AS package_id, cp.curriculum_id
  FROM course_packages cp
  WHERE cp.status IN ('blocked','pending','building')
    AND cp.curriculum_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM question_blueprints qb
      WHERE qb.curriculum_id = cp.curriculum_id AND qb.status = 'approved'
    )
    AND NOT EXISTS (
      SELECT 1 FROM blueprint_variant_inventory bvi
      WHERE bvi.package_id = cp.id
    )
  LIMIT p_limit;
$$;