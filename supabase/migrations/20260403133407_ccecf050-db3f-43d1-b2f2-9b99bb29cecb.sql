
CREATE OR REPLACE FUNCTION pipeline_write_lesson_content(p_lesson_id uuid, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);
  UPDATE public.lessons
  SET content = p_content
  WHERE id = p_lesson_id;
END;
$$;
