
-- Safe package status transition: archives conflicting packages before update
-- Prevents unique constraint violation on uniq_visible_package_per_curriculum
CREATE OR REPLACE FUNCTION public.safe_transition_package_status(
  p_package_id uuid,
  p_new_status text,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_visible_statuses text[] := ARRAY['planning','queued','building','failed','published','draft'];
BEGIN
  -- Get curriculum_id for this package
  SELECT curriculum_id INTO v_curriculum_id
  FROM public.course_packages
  WHERE id = p_package_id;

  -- If transitioning INTO a visible status and curriculum_id exists,
  -- archive any OTHER package with the same curriculum that's already visible
  IF v_curriculum_id IS NOT NULL AND p_new_status = ANY(v_visible_statuses) THEN
    UPDATE public.course_packages
    SET status = 'archived', updated_at = now()
    WHERE curriculum_id = v_curriculum_id
      AND id <> p_package_id
      AND status = ANY(v_visible_statuses);
  END IF;

  -- Now safely update the target package
  UPDATE public.course_packages
  SET status = p_new_status,
      stuck_reason = CASE WHEN p_extra ? 'stuck_reason' THEN p_extra->>'stuck_reason' ELSE NULL END,
      last_error = CASE WHEN p_extra ? 'last_error' THEN p_extra->>'last_error' ELSE last_error END,
      updated_at = now()
  WHERE id = p_package_id;
END;
$$;

COMMENT ON FUNCTION public.safe_transition_package_status IS
  'Atomically transitions a package status while archiving conflicting packages for the same curriculum to prevent uniq_visible_package_per_curriculum violations.';
