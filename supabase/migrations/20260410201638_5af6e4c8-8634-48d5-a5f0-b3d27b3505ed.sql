
-- 1. Dedupe-Trigger
CREATE OR REPLACE FUNCTION public.dedupe_humor_delivery()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM humor_delivery_events
    WHERE user_id = NEW.user_id
      AND humor_item_id = NEW.humor_item_id
      AND surface = NEW.surface
      AND created_at > now() - interval '60 seconds'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dedupe_humor_delivery ON humor_delivery_events;
CREATE TRIGGER trg_dedupe_humor_delivery
  BEFORE INSERT ON humor_delivery_events
  FOR EACH ROW
  EXECUTE FUNCTION public.dedupe_humor_delivery();

-- 2. Drop + Recreate RPC with same return signature
DROP FUNCTION IF EXISTS public.get_humor_for_surface(uuid, text, uuid, uuid);

CREATE FUNCTION public.get_humor_for_surface(
  p_certification_id uuid,
  p_surface text,
  p_competence_id uuid DEFAULT NULL,
  p_lesson_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  text text,
  humor_type humor_type,
  tone text,
  modernity_level integer,
  competence_id uuid,
  lesson_id uuid,
  quality_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_humor_enabled boolean := true;
BEGIN
  SELECT uhp.humor_enabled INTO v_humor_enabled
  FROM user_humor_preferences uhp
  WHERE uhp.user_id = v_user_id;
  
  IF v_humor_enabled IS NOT NULL AND v_humor_enabled = false THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH seen AS (
    SELECT DISTINCT hde.humor_item_id
    FROM humor_delivery_events hde
    WHERE hde.user_id = v_user_id
      AND hde.created_at > now() - interval '7 days'
  ),
  candidates AS (
    SELECT
      hi.id,
      hi.text,
      hi.humor_type,
      hi.tone,
      hi.modernity_level,
      hi.competence_id,
      hi.lesson_id,
      hi.quality_score,
      CASE
        WHEN p_lesson_id IS NOT NULL AND hi.lesson_id = p_lesson_id THEN 100
        WHEN p_competence_id IS NOT NULL AND hi.competence_id = p_competence_id THEN 80
        WHEN hi.competence_id IS NULL AND hi.lesson_id IS NULL THEN 50
        ELSE 30
      END AS relevance,
      CASE WHEN s.humor_item_id IS NULL THEN 1 ELSE 0 END AS is_fresh
    FROM humor_items hi
    LEFT JOIN seen s ON s.humor_item_id = hi.id
    WHERE hi.certification_id = p_certification_id
      AND hi.status IN ('approved', 'frozen')
      AND (hi.valid_from IS NULL OR hi.valid_from <= current_date)
      AND (hi.valid_to IS NULL OR hi.valid_to >= current_date)
      AND (
        CASE p_surface
          WHEN 'lesson_intro' THEN hi.humor_type IN ('wordplay', 'everyday_situation')
          WHEN 'lesson_outro' THEN hi.humor_type IN ('micro_tip', 'self_irony')
          WHEN 'minicheck_intro' THEN hi.humor_type IN ('exam_stress', 'self_irony')
          WHEN 'minicheck_result' THEN hi.humor_type IN ('self_irony', 'micro_tip')
          WHEN 'exam_break' THEN hi.humor_type IN ('exam_stress', 'self_irony', 'wordplay')
          ELSE true
        END
      )
  )
  SELECT
    c.id, c.text, c.humor_type, c.tone, c.modernity_level,
    c.competence_id, c.lesson_id, c.quality_score
  FROM candidates c
  ORDER BY c.is_fresh DESC, c.relevance DESC, c.quality_score DESC, random()
  LIMIT 1;
END;
$$;
