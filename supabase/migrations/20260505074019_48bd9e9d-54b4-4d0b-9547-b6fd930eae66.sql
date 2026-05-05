CREATE OR REPLACE FUNCTION public.fn_is_bronze_locked(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM course_packages
     WHERE id = p_package_id
       AND (
         (feature_flags->'bronze'->>'requires_review')::boolean = true
         OR (feature_flags->'bronze'->>'repair_attempts')::int >= 1
         OR (feature_flags->'bronze'->>'final_state') IN ('requires_review','manual_review_required')
       )
       AND NOT (feature_flags ? 'admin_force_building_at')
       AND COALESCE((feature_flags->'bronze'->>'manual_bypass')::boolean, false) = false
  );
$$;