
CREATE OR REPLACE FUNCTION public.is_hollow_lesson(p_content jsonb, p_step text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT
    CASE WHEN p_step = 'mini_check' THEN false
    ELSE (
      p_content IS NULL
      OR p_content->>'_placeholder' = 'true'
      OR length(COALESCE(p_content::text, '')) < 300
    )
    END;
$$;
