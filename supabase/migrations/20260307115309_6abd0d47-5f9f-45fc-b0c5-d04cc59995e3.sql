
-- ══════════════════════════════════════════════════════════════
-- SSOT HARDENING PACK: Domain-level utility functions
-- Centralizes "real content", "hollow lesson" usage in 
-- guard_publish_requires_real_content and package_lessons_realness
-- ══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 1. SSOT UTILITY: is_real_lesson_content(content jsonb, step text)
--    Inverse of is_hollow_lesson but with stricter "real" criteria:
--    content must have _placeholder!=true, html key with >400 chars,
--    and total content >200 chars. mini_check is always "real".
-- ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.is_real_lesson_content(jsonb, text);

CREATE OR REPLACE FUNCTION public.is_real_lesson_content(p_content jsonb, p_step text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    CASE WHEN p_step = 'mini_check' THEN true
    ELSE (
      p_content IS NOT NULL
      AND COALESCE(p_content->>'_placeholder', '') != 'true'
      AND length(COALESCE(p_content::text, '')) > 200
      AND p_content->>'html' IS NOT NULL
      AND length(COALESCE(p_content->>'html', '')) > 400
    )
    END;
$$;

COMMENT ON FUNCTION public.is_real_lesson_content(jsonb, text) IS
  'SSOT: Single check for "real lesson content" (not hollow, has HTML >400 chars). '
  'Inverse complement of is_hollow_lesson. Use in publish guards & realness RPCs.';


-- ────────────────────────────────────────────────────────────
-- 2. Refactor package_lessons_realness to use SSOT utilities
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.package_lessons_realness(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'lessons_total', COUNT(*)::int,
    'real_content', COUNT(*) FILTER (
      WHERE is_real_lesson_content(l.content, l.step::text)
    )::int,
    'placeholders', COUNT(*) FILTER (
      WHERE is_hollow_lesson(l.content, l.step::text)
    )::int,
    'emptyish', COUNT(*) FILTER (
      WHERE length(COALESCE(l.content::text,'')) < 100
    )::int,
    'avg_len', COALESCE(AVG(length(COALESCE(l.content::text,'')))::int, 0)
  )
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  JOIN course_packages cp ON cp.course_id = c.id
  WHERE cp.id = p_package_id
    AND l.step::text != 'mini_check';
$$;


-- ────────────────────────────────────────────────────────────
-- 3. Refactor guard_publish_requires_real_content to use SSOT utilities
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_publish_requires_real_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track text;
  v_total int;
  v_real int;
  v_placeholder int;
  v_reason text;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    v_track := COALESCE(NEW.track, 'AUSBILDUNG_VOLL');

    -- EXAM_FIRST: no learning content required
    IF v_track = 'EXAM_FIRST' THEN
      RETURN NEW;
    END IF;

    -- Total lessons (excluding mini_check via SSOT convention)
    SELECT COUNT(*) INTO v_total
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND l.step::text != 'mini_check';

    -- Real content via SSOT utility
    SELECT COUNT(*) INTO v_real
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND is_real_lesson_content(l.content, l.step::text);

    -- Placeholders via SSOT utility
    SELECT COUNT(*) INTO v_placeholder
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND is_hollow_lesson(l.content, l.step::text);

    IF v_total > 0 AND (v_real = 0 OR v_placeholder = v_total OR v_real < CEIL(v_total * 0.85)) THEN
      v_reason := format('PUBLISH_BLOCKED: Hollow content (real=%s, placeholder=%s, total=%s)', v_real, v_placeholder, v_total);

      INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (format('Publish blocked (content): %s', COALESCE(NEW.title, NEW.id::text)),
              v_reason,
              'error', 'pipeline', 'course_package', NEW.id::text);

      RAISE EXCEPTION '%', v_reason USING ERRCODE='P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
