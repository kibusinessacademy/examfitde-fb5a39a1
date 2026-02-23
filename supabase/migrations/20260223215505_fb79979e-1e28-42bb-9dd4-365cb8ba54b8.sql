-- Fix: pipeline_write_lesson_content resets bypass after write
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
  IF COALESCE((p_content->>'_placeholder')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNCIL_REQUIRED: pipeline_write_lesson_content accepts placeholder-only content. Use content_versions + publish_approved_version() for final content.';
  END IF;

  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE public.lessons
  SET content = p_content,
      status = 'placeholder',
      updated_at = now()
  WHERE id = p_lesson_id;

  -- Reset bypass flag (defense-in-depth)
  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;