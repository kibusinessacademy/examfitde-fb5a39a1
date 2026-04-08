
CREATE OR REPLACE FUNCTION guard_publish_requires_questions()
RETURNS trigger
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

    IF NOT COALESCE(NEW.integrity_passed, false) THEN
      v_reason := format('PUBLISH_BLOCKED: integrity_passed is false (package=%s, track=%s)', NEW.id, v_track);
      INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (format('Publish blocked (integrity): %s', COALESCE(NEW.title, NEW.id::text)),
              v_reason, 'error', 'pipeline', 'course_package', NEW.id);
      RAISE EXCEPTION '%', v_reason USING ERRCODE='P0001';
    END IF;

    v_min_questions := CASE
      WHEN v_track IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS') THEN 25
      WHEN v_track = 'ELITE' THEN 200
      ELSE 100
    END;

    SELECT COUNT(*) INTO v_approved_q
    FROM public.exam_questions q
    WHERE q.curriculum_id = NEW.curriculum_id AND q.status = 'approved';

    IF v_approved_q < v_min_questions THEN
      v_reason := format('PUBLISH_BLOCKED: Only %s approved questions (min %s, track=%s)', v_approved_q, v_min_questions, v_track);
      INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (format('Publish blocked: %s', COALESCE(NEW.title, NEW.id::text)),
              v_reason, 'error', 'pipeline', 'course_package', NEW.id);
      RAISE EXCEPTION '%', v_reason USING ERRCODE='P0001';
    END IF;

    -- Enrichment check: skip for tracks without learning content
    IF v_track NOT IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS') THEN
      SELECT COUNT(*),
             COUNT(*) FILTER (WHERE COALESCE(comp.enrichment_version,0) >= 2)
        INTO v_total_comps, v_enriched_comps
      FROM public.learning_fields lf
      JOIN public.competencies comp ON comp.learning_field_id = lf.id
      WHERE lf.curriculum_id = NEW.curriculum_id;

      IF v_total_comps > 0 AND v_enriched_comps < v_total_comps THEN
        v_reason := format('PUBLISH_BLOCKED: Enrichment %s/%s (%s%%)', v_enriched_comps, v_total_comps, round(100.0 * v_enriched_comps / v_total_comps));
        INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
        VALUES (format('Publish blocked (enrichment): %s', COALESCE(NEW.title, NEW.id::text)),
                v_reason, 'error', 'pipeline', 'course_package', NEW.id);
        RAISE EXCEPTION '%', v_reason USING ERRCODE='P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
