
-- Create admin function to unseal a course for regeneration
-- Uses session_replication_role to temporarily bypass triggers
CREATE OR REPLACE FUNCTION public.admin_unseal_course_for_regen(p_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_status text;
BEGIN
  SELECT autopilot_status INTO v_current_status FROM courses WHERE id = p_course_id;
  
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Course not found: %', p_course_id;
  END IF;
  
  IF v_current_status != 'sealed' THEN
    RAISE EXCEPTION 'Course is not sealed (current: %)', v_current_status;
  END IF;

  -- Temporarily disable the reseal guard trigger
  ALTER TABLE courses DISABLE TRIGGER trg_guard_course_reseal;
  
  UPDATE courses 
  SET autopilot_status = 'active', 
      status = 'generating'
  WHERE id = p_course_id;
  
  -- Re-enable the trigger immediately
  ALTER TABLE courses ENABLE TRIGGER trg_guard_course_reseal;
END;
$$;
