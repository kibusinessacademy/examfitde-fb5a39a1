
-- Make guard_publish_requires_questions track-aware
-- EXAM_FIRST: min 25 approved questions (vs 100 for full track)
CREATE OR REPLACE FUNCTION guard_publish_requires_questions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved_q bigint;
  v_total_comps bigint;
  v_enriched_comps bigint;
  v_min_questions integer;
  v_track text;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    -- Track-aware minimum
    v_track := COALESCE(NEW.track, 'AUSBILDUNG_VOLL');
    IF v_track = 'EXAM_FIRST' THEN
      v_min_questions := 25;
    ELSE
      v_min_questions := 100;
    END IF;

    SELECT count(*) INTO v_approved_q
    FROM exam_questions eq
    JOIN learning_fields lf ON eq.learning_field_id = lf.id
    WHERE lf.curriculum_id = NEW.curriculum_id
      AND eq.status = 'approved';

    SELECT count(*), count(*) FILTER (WHERE comp.enrichment_version >= 2)
    INTO v_total_comps, v_enriched_comps
    FROM learning_fields lf
    JOIN competencies comp ON comp.learning_field_id = lf.id
    WHERE lf.curriculum_id = NEW.curriculum_id;

    IF v_approved_q < v_min_questions THEN
      NEW.status := 'quality_gate_failed';
      NEW.blocked_reason := format(
        'PUBLISH_GATE: Only %s approved questions (min %s, track=%s)',
        v_approved_q, v_min_questions, v_track
      );
      NEW.updated_at := now();
      INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (format('Publish blocked: %s', NEW.title),
              format('%s approved questions < %s minimum (track=%s)', v_approved_q, v_min_questions, v_track),
              'error', 'pipeline', 'course_package', NEW.id);
    END IF;
    
    IF v_total_comps > 0 AND v_enriched_comps < v_total_comps AND NEW.status = 'published' THEN
      NEW.status := 'quality_gate_failed';
      NEW.blocked_reason := format(
        'PUBLISH_GATE: Enrichment %s/%s (%s%%)',
        v_enriched_comps, v_total_comps, round(100.0 * v_enriched_comps / v_total_comps)
      );
      NEW.updated_at := now();
      INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (format('Publish blocked (enrichment): %s', NEW.title),
              format('Enrichment %s%% < 100%%', round(100.0 * v_enriched_comps / v_total_comps)),
              'error', 'pipeline', 'course_package', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Also make guard_publish_requires_real_content skip for EXAM_FIRST (no lessons expected)
CREATE OR REPLACE FUNCTION guard_publish_requires_real_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_real int;
  v_placeholder int;
  v_cv_approved int;
  v_qc_approved int;
  v_track text;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    v_track := COALESCE(NEW.track, 'AUSBILDUNG_VOLL');
    
    -- EXAM_FIRST has no learning content — skip real-content gate entirely
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

    SELECT COUNT(*) INTO v_cv_approved
    FROM public.content_versions cv
    JOIN public.lessons l ON l.id = cv.lesson_id
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND cv.status = 'approved';

    SELECT COUNT(*) INTO v_qc_approved
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND l.qc_status = 'approved';

    IF v_total > 0 AND (
         v_real = 0
      OR v_placeholder = v_total
      OR v_real < CEIL(v_total * 0.85)
    ) THEN
      NEW.status := 'quality_gate_failed';
      NEW.published_at := NULL;
      NEW.integrity_passed := false;
      NEW.integrity_report := jsonb_set(
        COALESCE(NEW.integrity_report, '{}'::jsonb),
        '{verdict}',
        '"HOLLOW_LESSONS"'::jsonb,
        true
      );
      RAISE WARNING 'PUBLISH_BLOCKED: hollow content for % (real=%, placeholder=%, total=%).',
        NEW.id, v_real, v_placeholder, v_total;
    ELSIF v_total > 0 AND (v_cv_approved = 0 OR v_qc_approved = 0) THEN
      NEW.status := 'quality_gate_failed';
      NEW.published_at := NULL;
      NEW.integrity_passed := false;
      NEW.integrity_report := jsonb_set(
        COALESCE(NEW.integrity_report, '{}'::jsonb),
        '{verdict}',
        '"GOVERNANCE_MISSING"'::jsonb,
        true
      );
      RAISE WARNING 'PUBLISH_BLOCKED: governance missing for % (cv_approved=%, qc_approved=%).',
        NEW.id, v_cv_approved, v_qc_approved;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
