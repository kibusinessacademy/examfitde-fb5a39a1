
-- 1. Harden log_humor_delivery: only update counter if insert succeeded
CREATE OR REPLACE FUNCTION public.log_humor_delivery(
  p_user_id uuid,
  p_humor_item_id uuid,
  p_surface text,
  p_curriculum_id uuid DEFAULT NULL,
  p_lesson_id uuid DEFAULT NULL,
  p_competence_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count integer := 0;
BEGIN
  INSERT INTO public.humor_delivery_events (
    user_id, humor_item_id, surface,
    curriculum_id, lesson_id, competence_id, session_id
  ) VALUES (
    p_user_id, p_humor_item_id, p_surface::humor_surface,
    p_curriculum_id, p_lesson_id, p_competence_id, p_session_id
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count > 0 THEN
    UPDATE public.humor_items
    SET shown_count = COALESCE(shown_count, 0) + 1,
        last_shown_at = now()
    WHERE id = p_humor_item_id;
  END IF;
END;
$$;

-- 2. Harden dedupe trigger: include context columns
CREATE OR REPLACE FUNCTION fn_dedupe_humor_delivery()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.humor_delivery_events
    WHERE humor_item_id = NEW.humor_item_id
      AND user_id = NEW.user_id
      AND surface = NEW.surface
      AND lesson_id IS NOT DISTINCT FROM NEW.lesson_id
      AND competence_id IS NOT DISTINCT FROM NEW.competence_id
      AND session_id IS NOT DISTINCT FROM NEW.session_id
      AND created_at > now() - interval '60 seconds'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
