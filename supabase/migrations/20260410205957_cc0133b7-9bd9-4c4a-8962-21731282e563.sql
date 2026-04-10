
-- 1. Extend humor_items with missing columns
ALTER TABLE humor_items
  ADD COLUMN IF NOT EXISTS curriculum_id uuid,
  ADD COLUMN IF NOT EXISTS blueprint_id uuid,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS explanation text,
  ADD COLUMN IF NOT EXISTS exam_relevance text,
  ADD COLUMN IF NOT EXISTS difficulty_context text,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS duplication_fingerprint text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Add constraint for difficulty_context
ALTER TABLE humor_items ADD CONSTRAINT chk_humor_difficulty_context
  CHECK (difficulty_context IS NULL OR difficulty_context IN ('easy','medium','hard'));

-- Add constraint for source_kind  
ALTER TABLE humor_items ADD CONSTRAINT chk_humor_source_kind
  CHECK (source_kind IN ('generated','edited','curated','imported'));

-- 2. Extend humor_delivery_events with context columns
ALTER TABLE humor_delivery_events
  ADD COLUMN IF NOT EXISTS curriculum_id uuid,
  ADD COLUMN IF NOT EXISTS lesson_id uuid,
  ADD COLUMN IF NOT EXISTS competency_id uuid,
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS dwell_ms integer;

-- 3. Create humor_asset_reviews
CREATE TABLE IF NOT EXISTS public.humor_asset_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  humor_item_id uuid NOT NULL REFERENCES public.humor_items(id) ON DELETE CASCADE,
  review_type text NOT NULL CHECK (review_type IN ('quality','safety','didactic_fit','duplicate_check','manual_review')),
  decision text NOT NULL CHECK (decision IN ('pass','warn','fail')),
  score numeric(5,2),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text NOT NULL DEFAULT 'system'
);

ALTER TABLE public.humor_asset_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on humor_asset_reviews"
  ON public.humor_asset_reviews FOR ALL
  USING (true) WITH CHECK (true);

-- 4. Create humor_generation_jobs
CREATE TABLE IF NOT EXISTS public.humor_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  curriculum_id uuid,
  target_count integer NOT NULL,
  humor_type text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  prompt_version text,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.humor_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on humor_generation_jobs"
  ON public.humor_generation_jobs FOR ALL
  USING (true) WITH CHECK (true);

-- 5. Additional indexes
CREATE INDEX IF NOT EXISTS idx_humor_items_curriculum ON humor_items(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_humor_items_blueprint ON humor_items(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_humor_items_fingerprint ON humor_items(duplication_fingerprint);
CREATE INDEX IF NOT EXISTS idx_humor_delivery_curriculum ON humor_delivery_events(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_humor_delivery_lesson ON humor_delivery_events(lesson_id);
CREATE INDEX IF NOT EXISTS idx_humor_asset_reviews_item ON humor_asset_reviews(humor_item_id);

-- 6. RPC: get_humor_asset_for_surface
CREATE OR REPLACE FUNCTION public.get_humor_asset_for_surface(
  p_user_id uuid,
  p_surface text,
  p_certification_id uuid,
  p_curriculum_id uuid DEFAULT NULL,
  p_lesson_id uuid DEFAULT NULL,
  p_competency_id uuid DEFAULT NULL,
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
      hi.humor_type::text,
      hi.text AS content,
      hi.explanation,
      (
        CASE WHEN hi.lesson_id IS NOT NULL AND hi.lesson_id = p_lesson_id THEN 100 ELSE 0 END +
        CASE WHEN hi.competence_id IS NOT NULL AND hi.competence_id = p_competency_id THEN 60 ELSE 0 END +
        CASE WHEN hi.blueprint_id IS NOT NULL AND hi.blueprint_id = p_blueprint_id THEN 40 ELSE 0 END +
        CASE WHEN hi.certification_id = p_certification_id THEN 20 ELSE 0 END +
        COALESCE(hi.quality_score::integer, 0)
      ) AS rank_score
    FROM humor_items hi
    WHERE hi.status = 'approved'
      AND hi.certification_id = p_certification_id
      AND (
        (p_surface = 'lesson_intro' AND hi.humor_type::text IN ('wordplay','everyday_situation')) OR
        (p_surface = 'lesson_outro' AND hi.humor_type::text IN ('micro_tip')) OR
        (p_surface = 'minicheck_intro' AND hi.humor_type::text IN ('exam_stress','self_irony')) OR
        (p_surface = 'minicheck_result' AND hi.humor_type::text IN ('micro_tip','self_irony')) OR
        (p_surface = 'tutor_reply' AND hi.humor_type::text IN ('wordplay','micro_tip')) OR
        (p_surface = 'dashboard' AND hi.humor_type::text IN ('self_irony','exam_stress')) OR
        (p_surface = 'marketing' AND hi.humor_type::text IN ('everyday_situation','wordplay'))
      )
      -- Exclude recently shown to this user (14 day cooldown)
      AND NOT EXISTS (
        SELECT 1 FROM humor_delivery_events hde
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

-- 7. RPC: log_humor_delivery
CREATE OR REPLACE FUNCTION public.log_humor_delivery(
  p_user_id uuid,
  p_humor_item_id uuid,
  p_surface text,
  p_curriculum_id uuid DEFAULT NULL,
  p_lesson_id uuid DEFAULT NULL,
  p_competency_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO humor_delivery_events (
    humor_item_id, user_id, surface,
    curriculum_id, lesson_id, competency_id, session_id
  ) VALUES (
    p_humor_item_id, p_user_id, p_surface::humor_surface,
    p_curriculum_id, p_lesson_id, p_competency_id, p_session_id
  );
  
  -- Update shown count on humor_items
  UPDATE humor_items
  SET shown_count = shown_count + 1,
      last_shown_at = now()
  WHERE id = p_humor_item_id;
END;
$$;

-- 8. Harden minicheck duplicate guard: also check competency_id when lesson_id is null
CREATE OR REPLACE FUNCTION fn_guard_minicheck_duplicate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_norm_text text;
BEGIN
  -- Normalize: lowercase, trim, collapse whitespace, strip punctuation variance
  v_norm_text := regexp_replace(lower(trim(NEW.question_text)), '\s+', ' ', 'g');
  
  IF NEW.is_duplicate IS NOT TRUE THEN
    IF NEW.lesson_id IS NOT NULL THEN
      -- Guard per lesson_id
      IF EXISTS (
        SELECT 1 FROM minicheck_questions
        WHERE lesson_id = NEW.lesson_id
          AND id != NEW.id
          AND is_duplicate IS NOT TRUE
          AND regexp_replace(lower(trim(question_text)), '\s+', ' ', 'g') = v_norm_text
      ) THEN
        NEW.is_duplicate := true;
        NEW.dedupe_batch := 'guard_lesson';
      END IF;
    ELSIF NEW.competency_id IS NOT NULL THEN
      -- Guard per competency_id when no lesson_id
      IF EXISTS (
        SELECT 1 FROM minicheck_questions
        WHERE competency_id = NEW.competency_id
          AND lesson_id IS NULL
          AND id != NEW.id
          AND is_duplicate IS NOT TRUE
          AND regexp_replace(lower(trim(question_text)), '\s+', ' ', 'g') = v_norm_text
      ) THEN
        NEW.is_duplicate := true;
        NEW.dedupe_batch := 'guard_competency';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
