
-- Surface enum for humor delivery contexts
CREATE TYPE public.humor_surface AS ENUM (
  'dashboard',
  'lesson_intro',
  'lesson_outro',
  'minicheck_intro',
  'minicheck_result',
  'tutor',
  'exam_break'
);

-- Reaction enum
CREATE TYPE public.humor_reaction AS ENUM (
  'liked',
  'disliked',
  'skipped',
  'shared'
);

-- Delivery events table: tracks every humor impression
CREATE TABLE public.humor_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  humor_item_id uuid NOT NULL REFERENCES public.humor_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  surface humor_surface NOT NULL,
  context_ref uuid NULL, -- lesson_id, minicheck_id, exam_session_id etc.
  reaction humor_reaction NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX idx_hde_user_surface ON public.humor_delivery_events(user_id, surface, created_at DESC);
CREATE INDEX idx_hde_humor_item ON public.humor_delivery_events(humor_item_id);
CREATE INDEX idx_hde_user_item ON public.humor_delivery_events(user_id, humor_item_id);

-- RLS
ALTER TABLE public.humor_delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own delivery events"
  ON public.humor_delivery_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own delivery events"
  ON public.humor_delivery_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own delivery reaction"
  ON public.humor_delivery_events FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Surface-aware humor selection function
CREATE OR REPLACE FUNCTION public.get_humor_for_surface(
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
  modernity_level int,
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
  -- Check opt-out
  SELECT uhp.humor_enabled INTO v_humor_enabled
  FROM user_humor_preferences uhp
  WHERE uhp.user_id = v_user_id;
  
  IF v_humor_enabled IS NOT NULL AND v_humor_enabled = false THEN
    RETURN; -- empty result = opted out
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
      -- Relevance score: prefer matching context
      CASE
        WHEN p_lesson_id IS NOT NULL AND hi.lesson_id = p_lesson_id THEN 100
        WHEN p_competence_id IS NOT NULL AND hi.competence_id = p_competence_id THEN 80
        WHEN hi.competence_id IS NULL AND hi.lesson_id IS NULL THEN 50
        ELSE 30
      END AS relevance,
      -- Freshness: unseen items preferred
      CASE WHEN s.humor_item_id IS NULL THEN 1 ELSE 0 END AS is_fresh
    FROM humor_items hi
    LEFT JOIN seen s ON s.humor_item_id = hi.id
    WHERE hi.certification_id = p_certification_id
      AND hi.status IN ('approved', 'frozen')
      AND (hi.valid_from IS NULL OR hi.valid_from <= current_date)
      AND (hi.valid_to IS NULL OR hi.valid_to >= current_date)
      -- Surface-specific type preferences
      AND (
        CASE p_surface
          WHEN 'lesson_intro' THEN hi.humor_type IN ('wordplay', 'everyday_situation')
          WHEN 'lesson_outro' THEN hi.humor_type IN ('micro_tip', 'self_irony')
          WHEN 'minicheck_intro' THEN hi.humor_type IN ('exam_stress', 'everyday_situation')
          WHEN 'minicheck_result' THEN hi.humor_type IN ('self_irony', 'micro_tip')
          WHEN 'exam_break' THEN hi.humor_type IN ('exam_stress', 'self_irony', 'wordplay')
          ELSE true -- dashboard, tutor = all types
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
