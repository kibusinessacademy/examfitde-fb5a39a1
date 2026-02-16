
-- Create a secure RPC for pipeline lesson write-back that bypasses council guard
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content(
  p_lesson_id uuid,
  p_content jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set the council bypass variable so the guard trigger allows the write
  PERFORM set_config('council.publish_bypass', 'true', true);
  
  UPDATE lessons
  SET content = p_content
  WHERE id = p_lesson_id;
END;
$$;

-- Grant execute to service_role only (not anon/authenticated)
REVOKE ALL ON FUNCTION public.pipeline_write_lesson_content(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pipeline_write_lesson_content(uuid, jsonb) TO service_role;
