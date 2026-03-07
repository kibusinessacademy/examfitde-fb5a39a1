
-- SSOT Hardening v2: 3 Korrekturen
-- 1. is_real_lesson_content() Kommentar korrigiert (nicht "inverse", sondern "strict publishable check")
-- 2. guard_publish_requires_real_content() dokumentiert course-scoped + blockt v_total=0
-- 3. Grauzone explizit dokumentiert

-- ═══════════════════════════════════════════════════════════════
-- 1. is_real_lesson_content() — Kommentar-Korrektur
--    NICHT das Inverse von is_hollow_lesson().
--    Grauzone existiert bewusst: content kann weder hollow noch real sein.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_real_lesson_content(p_content jsonb, p_step text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  -- SSOT: strict check for publishable lesson content.
  -- NOT the inverse of is_hollow_lesson(). A deliberate grey zone exists:
  --   is_hollow_lesson = false AND is_real_lesson_content = false
  -- means: content exists but is not yet publish-quality.
  -- mini_check steps are always considered real (no generated content expected).
  SELECT
    CASE WHEN p_step = 'mini_check' THEN true
    ELSE (
      p_content IS NOT NULL
      AND COALESCE(p_content->>'_placeholder', '') != 'true'
      AND length(p_content::text) > 200
      AND length(COALESCE(p_content->>'html', '')) > 400
    )
    END;
$$;

COMMENT ON FUNCTION public.is_real_lesson_content(jsonb, text) IS
  'SSOT: strict publishable-content check. NOT the inverse of is_hollow_lesson(). '
  'Grey zone (not hollow, not real) = content exists but below publish quality. '
  'mini_check always returns true.';

-- ═══════════════════════════════════════════════════════════════
-- 2. guard_publish_requires_real_content() — v_total=0 blocken + course-scoped dokumentieren
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.guard_publish_requires_real_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_total   int;
  v_real    int;
  v_hollow  int;
BEGIN
  -- Only fire on status change to 'published'
  IF NEW.status IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;

  -- Publish guard validates course-level lessons via NEW.course_id
  -- because lessons are course-scoped SSOT (modules → course_id), not package-scoped.
  -- If future model requires package-scoped variants, this must be refactored.

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE public.is_real_lesson_content(l.content, l.step::text)),
    COUNT(*) FILTER (WHERE public.is_hollow_lesson(l.content, l.step::text))
  INTO v_total, v_real, v_hollow
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = NEW.course_id;

  -- HARD BLOCK: zero lessons = not publishable
  IF v_total = 0 THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKED: No lessons found for course_id=% (package=%)', NEW.course_id, NEW.id;
  END IF;

  -- HARD BLOCK: any hollow lessons remain
  IF v_hollow > 0 THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKED: % hollow lessons remain (total=%, real=%, course_id=%)',
      v_hollow, v_total, v_real, NEW.course_id;
  END IF;

  -- HARD BLOCK: insufficient real content (at least 90% must be real)
  IF v_real < GREATEST(1, floor(v_total * 0.9)::int) THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKED: Only %/% lessons have real content (min 90%% required, course_id=%)',
      v_real, v_total, NEW.course_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_publish_requires_real_content() IS
  'Publish gate: blocks course_packages → published unless lessons pass SSOT quality checks. '
  'Course-scoped (not package-scoped) because lessons attach via modules.course_id. '
  'Blocks: 0 lessons, any hollow lessons, <90% real content.';
