
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

  ALTER TABLE courses DISABLE TRIGGER guard_course_reseal;
  
  UPDATE courses 
  SET autopilot_status = 'active', 
      status = 'generating'
  WHERE id = p_course_id;
  
  ALTER TABLE courses ENABLE TRIGGER guard_course_reseal;
END;
$$;
