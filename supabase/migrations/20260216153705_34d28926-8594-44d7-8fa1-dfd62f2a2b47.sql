
-- 1) Create missing RPC: pipeline_write_lesson_content
-- Merges generated content into the lessons.content JSONB column
-- and clears the _placeholder flag
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
  UPDATE lessons
  SET content = p_content,
      status = CASE WHEN status = 'placeholder' THEN 'draft' ELSE status END
  WHERE id = p_lesson_id;
END;
$$;
