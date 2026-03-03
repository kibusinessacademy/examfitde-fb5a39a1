-- Convert publish guard triggers from "silent flip to quality_gate_failed"
-- to "hard block publish via RAISE EXCEPTION" (no flapping, deterministic).

CREATE OR REPLACE FUNCTION public.guard_publish_requires_questions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track text;
  v_min_questions int;
  v_approved_q int;
  v_total_comps int;
  v_enriched_comps int;
  v_reason text;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    v_track := COALESCE(NEW.track, 'AUSBILDUNG_VOLL');

    v_min_questions := CASE
      WHEN v_track = 'EXAM_FIRST' THEN 25
      WHEN v_track = 'ELITE' THEN 200
      ELSE 100
    END;

    SELECT COUNT(*) INTO v_approved_q
    FROM public.exam_questions q
    WHERE q.package_id = NEW.id
      AND q.status = 'approved';

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE COALESCE(comp.enrichment_version,0) >= 2)
      INTO v_total_comps, v_enriched_comps
    FROM public.learning_fields lf
    JOIN public.competencies comp ON comp.learning_field_id = lf.id
    WHERE lf.curriculum_id = NEW.curriculum_id;

    IF v_approved_q < v_min_questions THEN
      v_reason := format('PUBLISH_BLOCKED: Only %s approved questions (min %s, track=%s)', v_approved_q, v_min_questions, v_track);

      INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (format('Publish blocked: %s', COALESCE(NEW.title, NEW.id::text)),
              v_reason,
              'error', 'pipeline', 'course_package', NEW.id::text);

      RAISE EXCEPTION '%', v_reason USING ERRCODE='P0001';
    END IF;

    IF v_total_comps > 0 AND v_enriched_comps < v_total_comps AND v_track <> 'EXAM_FIRST' THEN
      v_reason := format('PUBLISH_BLOCKED: Enrichment %s/%s (%s%%)', v_enriched_comps, v_total_comps, round(100.0 * v_enriched_comps / v_total_comps));

      INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (format('Publish blocked (enrichment): %s', COALESCE(NEW.title, NEW.id::text)),
              v_reason,
              'error', 'pipeline', 'course_package', NEW.id::text);

      RAISE EXCEPTION '%', v_reason USING ERRCODE='P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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

    SELECT COUNT(*) INTO v_total
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id;

    SELECT COUNT(*) INTO v_real
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND l.content IS NOT NULL
      AND length(l.content::text) > 200
      AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
      AND (l.content->>'html') IS NOT NULL
      AND length(l.content->>'html') > 400;

    SELECT COUNT(*) INTO v_placeholder
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND (l.content->>'_placeholder')::text = 'true';

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