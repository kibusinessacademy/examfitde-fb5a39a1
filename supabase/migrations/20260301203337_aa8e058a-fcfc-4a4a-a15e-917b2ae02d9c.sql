
-- =====================================================
-- HOLLOW SHELL REMEDIATION + PREVENTION
-- =====================================================

-- 1) Extend immutable guard: allow published → quality_gate_failed
--    (for governance-driven downgrades of hollow/broken packages)
CREATE OR REPLACE FUNCTION public.guard_published_package_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow status change TO 'archived' (retirement of old packages)
  IF NEW.status = 'archived' AND OLD.status IN ('published', 'quality_gate_failed', 'done', 'council_review') THEN
    RETURN NEW;
  END IF;

  -- Allow status change TO 'quality_gate_failed' (governance-driven downgrade)
  IF NEW.status = 'quality_gate_failed' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- Allow cosmetic metadata maintenance on published packages
  IF OLD.published_at IS NOT NULL AND OLD.status = 'published' THEN
    -- Block content-altering changes
    IF NEW.status IS DISTINCT FROM OLD.status 
       AND NEW.status NOT IN ('archived', 'quality_gate_failed') THEN
      RAISE EXCEPTION 'IMMUTABLE_PACKAGE: Cannot change status of published package %', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Publish readiness view (SSOT for hollow detection)
CREATE OR REPLACE VIEW public.v_package_publish_readiness AS
SELECT
  cp.id AS package_id,
  cp.status,
  cp.course_id,
  cp.title,

  -- lesson counts
  (SELECT COUNT(*)
   FROM public.lessons l
   JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = cp.course_id) AS lessons_total,

  (SELECT COUNT(*)
   FROM public.lessons l
   JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = cp.course_id
     AND l.content IS NOT NULL
     AND length(l.content::text) > 200
     AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
     AND (l.content->>'html') IS NOT NULL
     AND length(l.content->>'html') > 400
  ) AS lessons_real,

  (SELECT COUNT(*)
   FROM public.lessons l
   JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = cp.course_id
     AND (l.content->>'_placeholder')::text = 'true'
  ) AS lessons_placeholder,

  -- governance: approved content_versions
  (SELECT COUNT(*)
   FROM public.content_versions cv
   JOIN public.lessons l ON l.id = cv.lesson_id
   JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = cp.course_id
     AND cv.status = 'approved'
  ) AS cv_approved,

  -- QC approved lessons
  (SELECT COUNT(*)
   FROM public.lessons l
   JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = cp.course_id
     AND l.qc_status = 'approved'
  ) AS lessons_qc_approved,

  -- exam questions
  (SELECT COUNT(*)
   FROM public.exam_questions eq
   JOIN public.courses c ON c.curriculum_id = eq.curriculum_id
   WHERE c.id = cp.course_id
     AND eq.status = 'approved'
  ) AS approved_questions

FROM public.course_packages cp;

-- 3) Hard gate: prevent publishing hollow packages
CREATE OR REPLACE FUNCTION public.guard_publish_requires_real_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_total int;
  v_real int;
  v_placeholder int;
BEGIN
  -- Only fire when transitioning TO published
  IF NEW.status != 'published' OR OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- Count lesson stats
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE l.content IS NOT NULL
                       AND length(l.content::text) > 200
                       AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
                       AND (l.content->>'html') IS NOT NULL
                       AND length(l.content->>'html') > 400),
    COUNT(*) FILTER (WHERE (l.content->>'_placeholder')::text = 'true')
  INTO v_total, v_real, v_placeholder
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = NEW.course_id;

  -- Block if all lessons are placeholders or no real content exists
  IF v_total > 0 AND (v_real = 0 OR v_placeholder = v_total) THEN
    -- Set to quality_gate_failed instead of raising
    NEW.status := 'quality_gate_failed';
    NEW.integrity_passed := false;
    NEW.integrity_report := jsonb_set(
      COALESCE(NEW.integrity_report, '{}'::jsonb),
      '{verdict}',
      '"HOLLOW_LESSONS: 0 real lessons found"'::jsonb,
      true
    );
    RAISE WARNING 'PUBLISH_BLOCKED: Package % has 0 real lessons (% total, % placeholder). Downgraded to quality_gate_failed.',
      NEW.id, v_total, v_placeholder;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists, then create trigger
DROP TRIGGER IF EXISTS trg_guard_publish_requires_real_content ON public.course_packages;
CREATE TRIGGER trg_guard_publish_requires_real_content
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_publish_requires_real_content();
