
-- 1. Rename column
ALTER TABLE public.humor_delivery_events 
  RENAME COLUMN competency_id TO competence_id;

-- 2. Drop functions with old signatures
DROP FUNCTION IF EXISTS public.get_humor_asset_for_surface(uuid, text, uuid, uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.log_humor_delivery(uuid, uuid, text, uuid, uuid, uuid, uuid);

-- 3. Recreate get_humor_asset_for_surface
CREATE OR REPLACE FUNCTION public.get_humor_asset_for_surface(
  p_user_id uuid,
  p_surface text,
  p_certification_id uuid,
  p_curriculum_id uuid DEFAULT NULL,
  p_lesson_id uuid DEFAULT NULL,
  p_competence_id uuid DEFAULT NULL,
  p_blueprint_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  humor_type text,
  content text,
  explanation text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      hi.id,
      hi.humor_type,
      hi.text AS content,
      hi.explanation,
      (
        CASE WHEN hi.lesson_id IS NOT NULL AND hi.lesson_id = p_lesson_id THEN 100 ELSE 0 END +
        CASE WHEN hi.competence_id IS NOT NULL AND hi.competence_id = p_competence_id THEN 60 ELSE 0 END +
        CASE WHEN hi.blueprint_id IS NOT NULL AND hi.blueprint_id = p_blueprint_id THEN 40 ELSE 0 END +
        CASE WHEN hi.certification_id = p_certification_id THEN 20 ELSE 0 END +
        COALESCE(hi.quality_score, 0)
      ) AS rank_score
    FROM public.humor_items hi
    WHERE hi.status = 'approved'
      AND hi.certification_id = p_certification_id
      AND (
        (p_surface = 'lesson_intro'    AND hi.humor_type IN ('wordplay','everyday_situation')) OR
        (p_surface = 'lesson_outro'    AND hi.humor_type IN ('micro_tip')) OR
        (p_surface = 'minicheck_intro' AND hi.humor_type IN ('exam_stress','self_irony')) OR
        (p_surface = 'minicheck_result'AND hi.humor_type IN ('micro_tip','self_irony')) OR
        (p_surface = 'tutor_reply'     AND hi.humor_type IN ('wordplay','micro_tip')) OR
        (p_surface = 'dashboard'       AND hi.humor_type IN ('self_irony','exam_stress')) OR
        (p_surface = 'marketing'       AND hi.humor_type IN ('everyday_situation','wordplay'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.humor_delivery_events hde
        WHERE hde.humor_item_id = hi.id
          AND hde.user_id = p_user_id
          AND hde.created_at > now() - interval '14 days'
      )
  )
  SELECT c.id, c.humor_type, c.content, c.explanation
  FROM candidates c
  ORDER BY c.rank_score DESC, random()
  LIMIT 1;
$$;

-- 4. Recreate log_humor_delivery
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
BEGIN
  INSERT INTO public.humor_delivery_events (
    user_id, humor_item_id, surface,
    curriculum_id, lesson_id, competence_id, session_id
  ) VALUES (
    p_user_id, p_humor_item_id, p_surface::humor_surface,
    p_curriculum_id, p_lesson_id, p_competence_id, p_session_id
  );

  UPDATE public.humor_items
  SET shown_count = COALESCE(shown_count, 0) + 1,
      last_shown_at = now()
  WHERE id = p_humor_item_id;
END;
$$;

-- 5. Recreate dedupe trigger function
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
      AND created_at > now() - interval '60 seconds'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
