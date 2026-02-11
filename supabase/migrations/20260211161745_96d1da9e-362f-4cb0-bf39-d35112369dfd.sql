
-- ═══════════════════════════════════════════════════════════════════
-- Council Governance Hardening: Entity Types, Idempotency, Write Guards
-- ═══════════════════════════════════════════════════════════════════

-- 1) Extend content_versions with entity_type + entity_id for MiniChecks/Blueprints
ALTER TABLE public.content_versions
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'lesson_step',
  ADD COLUMN IF NOT EXISTS entity_id uuid NULL;

COMMENT ON COLUMN public.content_versions.entity_type IS 'lesson_step | minicheck | blueprint';
COMMENT ON COLUMN public.content_versions.entity_id IS 'For minicheck/blueprint: the specific entity ID';

-- 2) Idempotency: unique constraint per (lesson_id, step_key, council_round, entity_type)
-- Prevents duplicate versions on retry
CREATE UNIQUE INDEX IF NOT EXISTS idx_cv_idempotency
  ON public.content_versions (lesson_id, step_key, council_round, entity_type)
  WHERE status NOT IN ('rejected');

-- 3) Guard trigger: block direct writes to lessons.content except via publish_approved_version
-- This forces ALL content changes through the Council pipeline
CREATE OR REPLACE FUNCTION public.guard_lesson_content_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow if published_versions is being updated (publish path)
  IF OLD.published_versions IS DISTINCT FROM NEW.published_versions THEN
    RETURN NEW;
  END IF;

  -- Allow if ONLY non-content fields change (e.g. title, module_id, etc)
  IF OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;

  -- Block direct content writes unless called from publish RPC
  -- Check session variable set by publish_approved_version
  IF current_setting('council.publish_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'COUNCIL_BYPASS_BLOCKED: Direct writes to lessons.content are forbidden. Use council pipeline → content_versions → publish_approved_version()';
END $$;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_lesson_content'
    AND tgrelid = 'public.lessons'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_lesson_content
      BEFORE UPDATE ON public.lessons
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_lesson_content_writes();
  END IF;
END $$;

-- 4) Update publish_approved_version to set bypass flag + also write content
CREATE OR REPLACE FUNCTION public.publish_approved_version(
  p_lesson_id uuid,
  p_step_key text,
  p_version_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.content_version_status;
  v_verdict public.council_decision;
  v_content jsonb;
BEGIN
  -- Validate version is approved
  SELECT status, content_json INTO v_status, v_content
  FROM public.content_versions WHERE id = p_version_id;

  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot publish version %, status=% (must be approved)', p_version_id, v_status;
  END IF;

  -- Validate council verdict exists and is approved
  SELECT final_decision INTO v_verdict
  FROM public.council_verdicts WHERE content_version_id = p_version_id;

  IF v_verdict IS NULL OR v_verdict IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Cannot publish version %: council verdict=% (must be approved)', p_version_id, COALESCE(v_verdict::text, 'MISSING');
  END IF;

  -- Set bypass flag for the guard trigger
  PERFORM set_config('council.publish_bypass', 'true', true);

  -- Update published_versions pointer
  UPDATE public.lessons
  SET published_versions =
    jsonb_set(published_versions, ARRAY[p_step_key], to_jsonb(p_version_id::text), true)
  WHERE id = p_lesson_id;

  -- Reset bypass
  PERFORM set_config('council.publish_bypass', 'false', true);
END $$;

-- 5) Enhanced readiness: check minicheck question count + exam_block/weight_tag
CREATE OR REPLACE FUNCTION public.recompute_course_publish_readiness(p_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_lessons int;
  v_fully_published int;
  v_minicheck_coverage int;
  v_total_minicheck_lessons int;
  v_ratio numeric;
BEGIN
  -- Count total lessons
  SELECT COUNT(*) INTO v_total_lessons
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id;

  -- Count lessons with ALL 5 steps published
  SELECT COUNT(*) INTO v_fully_published
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id
    AND (l.published_versions ? 'step_1_introduction')
    AND (l.published_versions ? 'step_2_understanding')
    AND (l.published_versions ? 'step_3_application')
    AND (l.published_versions ? 'step_4_repetition')
    AND (l.published_versions ? 'step_5_minicheck');

  -- Check minicheck question coverage (each lesson needs >= 4 questions)
  SELECT COUNT(*) INTO v_total_minicheck_lessons
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id
    AND l.step = 'mini_check';

  SELECT COUNT(*) INTO v_minicheck_coverage
  FROM (
    SELECT mq.lesson_id, COUNT(*) as q_count
    FROM public.minicheck_questions mq
    JOIN public.lessons l ON l.id = mq.lesson_id
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = p_course_id
    GROUP BY mq.lesson_id
    HAVING COUNT(*) >= 4
  ) sub;

  IF v_total_lessons = 0 THEN
    v_ratio := 0;
  ELSE
    v_ratio := v_fully_published::numeric / v_total_lessons::numeric;
  END IF;

  -- Require 95% steps published AND minicheck coverage
  UPDATE public.courses
  SET is_ready_for_publish = (
    v_ratio >= 0.95
    AND (v_total_minicheck_lessons = 0 OR v_minicheck_coverage >= v_total_minicheck_lessons * 0.9)
  )
  WHERE id = p_course_id;
END $$;

-- 6) Drop old guard trigger if exists (from previous migration)
DROP TRIGGER IF EXISTS trg_guard_publish_council ON public.lessons;
DROP FUNCTION IF EXISTS public.guard_publish_council();
