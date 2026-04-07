
-- 1. Add skip_reason to daily_question_picks
ALTER TABLE public.daily_question_picks 
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;

-- 2. Unique constraint on growth_content_queue to prevent duplicates
ALTER TABLE public.growth_content_queue 
  ADD CONSTRAINT uq_growth_queue_source_platform 
  UNIQUE (source_type, source_id, platform, channel);

-- 3. Unique constraint on trap_content_pages
ALTER TABLE public.trap_content_pages 
  ADD CONSTRAINT uq_trap_page_curriculum_trap 
  UNIQUE (curriculum_id, trap_type);

-- 4. Update fn_pick_daily_question to only pick MC/SC types
CREATE OR REPLACE FUNCTION public.fn_pick_daily_question(p_curriculum_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_existing UUID;
  v_question RECORD;
  v_curriculum RECORD;
  v_slug TEXT;
BEGIN
  -- Check if already picked today
  SELECT id INTO v_existing
  FROM daily_question_picks
  WHERE day = v_today AND curriculum_id = p_curriculum_id;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('already_picked', true, 'pick_id', v_existing);
  END IF;

  -- Get curriculum info for slug
  SELECT title, slug INTO v_curriculum
  FROM curricula WHERE id = p_curriculum_id;

  -- Pick best question: approved, MC/SC only, has trap, not used in last 90 days
  SELECT eq.id, eq.question_text, eq.explanation, eq.trap_tags,
         eq.blueprint_id, eq.difficulty, eq.competency_id,
         eq.options, eq.correct_answer, eq.cognitive_level, eq.question_type
  INTO v_question
  FROM exam_questions eq
  WHERE eq.curriculum_id = p_curriculum_id
    AND eq.status = 'approved'
    AND COALESCE(eq.question_type, 'multiple_choice') IN ('multiple_choice', 'single_choice')
    AND eq.trap_tags IS NOT NULL
    AND array_length(eq.trap_tags, 1) > 0
    AND eq.id NOT IN (
      SELECT exam_question_id FROM daily_question_picks
      WHERE curriculum_id = p_curriculum_id
        AND exam_question_id IS NOT NULL
        AND day > v_today - INTERVAL '90 days'
    )
  ORDER BY
    array_length(eq.trap_tags, 1) DESC,
    CASE eq.difficulty
      WHEN 'medium' THEN 1
      WHEN 'hard' THEN 2
      WHEN 'easy' THEN 3
      ELSE 4
    END,
    random()
  LIMIT 1;

  IF v_question.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_eligible_questions');
  END IF;

  -- Generate slug
  v_slug := to_char(v_today, 'YYYY-MM-DD') || '-' || COALESCE(v_curriculum.slug, 'frage');

  -- Insert pick as draft
  INSERT INTO daily_question_picks (day, curriculum_id, exam_question_id, blueprint_id, trap_type, slug, status)
  VALUES (v_today, p_curriculum_id, v_question.id, v_question.blueprint_id,
          v_question.trap_tags[1], v_slug, 'draft')
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object(
    'pick_id', v_existing,
    'question_id', v_question.id,
    'slug', v_slug,
    'trap_type', v_question.trap_tags[1],
    'difficulty', v_question.difficulty
  );
END;
$$;

-- 5. Update fn_growth_engine_overview with quality metrics
CREATE OR REPLACE FUNCTION public.fn_growth_engine_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'daily_questions', (SELECT jsonb_build_object(
      'total', COUNT(*),
      'published', COUNT(*) FILTER (WHERE status = 'published'),
      'draft', COUNT(*) FILTER (WHERE status = 'draft'),
      'failed', COUNT(*) FILTER (WHERE status = 'failed_generation'),
      'skipped', COUNT(*) FILTER (WHERE status = 'skipped'),
      'today', COUNT(*) FILTER (WHERE day = CURRENT_DATE),
      'conversion_rate', CASE WHEN COUNT(*) > 0 
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'published') / COUNT(*), 1)
        ELSE 0 END
    ) FROM daily_question_picks),
    'trap_pages', (SELECT jsonb_build_object(
      'total', COUNT(*),
      'published', COUNT(*) FILTER (WHERE status = 'published'),
      'draft', COUNT(*) FILTER (WHERE status = 'draft'),
      'curricula_covered', COUNT(DISTINCT curriculum_id)
    ) FROM trap_content_pages),
    'growth_queue', (SELECT jsonb_build_object(
      'total', COUNT(*),
      'ready', COUNT(*) FILTER (WHERE status = 'ready'),
      'posted', COUNT(*) FILTER (WHERE status = 'posted'),
      'failed', COUNT(*) FILTER (WHERE status = 'failed'),
      'by_platform', (SELECT jsonb_object_agg(platform, cnt) FROM (
        SELECT platform, COUNT(*) as cnt FROM growth_content_queue GROUP BY platform
      ) sub)
    ) FROM growth_content_queue)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
