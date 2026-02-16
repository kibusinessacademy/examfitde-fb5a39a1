CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content(p_lesson_id uuid, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set bypass so guard_lesson_content_writes trigger allows the write
  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE lessons
  SET content = p_content,
      status = CASE WHEN status = 'placeholder' THEN 'draft' ELSE status END
  WHERE id = p_lesson_id;
END;
$$;