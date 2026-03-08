-- Wave E Phase 2: Promote 5 candidates directly

DO $$
DECLARE
  v_rec record;
  v_curriculum_id uuid;
  v_course_id uuid;
  v_beruf_id uuid;
  v_promoted int := 0;
  v_curriculum_typ text;
BEGIN
  FOR v_rec IN
    SELECT
      wc.id AS wc_id,
      wc.qualification_catalog_id,
      wc.draft_id,
      wc.readiness_score,
      wc.promotion_priority,
      qc.canonical_title,
      qc.education_type,
      qc.award_type,
      d.id AS draft_row_id,
      d.draft_title,
      d.structure_json,
      d.promoted_curriculum_id
    FROM qualification_wave_candidates wc
    JOIN qualification_catalog qc ON qc.id = wc.qualification_catalog_id
    LEFT JOIN qualification_curriculum_drafts d ON d.id = wc.draft_id
    WHERE wc.candidate_status = 'ready'
    ORDER BY wc.promotion_priority DESC
    LIMIT 5
  LOOP
    IF v_rec.promoted_curriculum_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_curriculum_typ := CASE
      WHEN v_rec.education_type ILIKE '%fortbildung%' THEN 'fortbildung'
      WHEN v_rec.education_type ILIKE '%schulisch%' THEN 'schulisch'
      ELSE 'betrieblich'
    END;

    -- Find matching beruf
    SELECT id INTO v_beruf_id
    FROM berufe
    WHERE lower(bezeichnung_kurz) = lower(v_rec.canonical_title)
       OR lower(bezeichnung_lang) = lower(v_rec.canonical_title)
       OR lower(bezeichnung_kurz) ILIKE '%' || lower(v_rec.canonical_title) || '%'
    LIMIT 1;

    -- Create curriculum
    INSERT INTO curricula (title, description, status, curriculum_typ, beruf_id)
    VALUES (
      initcap(coalesce(v_rec.draft_title, v_rec.canonical_title)),
      'Auto-generated from Wave E Phase 2: ' || v_rec.canonical_title,
      'draft',
      v_curriculum_typ,
      v_beruf_id
    )
    RETURNING id INTO v_curriculum_id;

    -- Create course
    INSERT INTO courses (curriculum_id, title, description, status, autopilot_status)
    VALUES (
      v_curriculum_id,
      'ExamFit – ' || initcap(coalesce(v_rec.draft_title, v_rec.canonical_title)),
      'Kurs für ' || initcap(v_rec.canonical_title),
      'draft',
      'idle'
    )
    RETURNING id INTO v_course_id;

    -- Factory intake
    INSERT INTO factory_intake_queue (curriculum_id, intake_status, detected_at, priority_score, readiness_snapshot)
    VALUES (
      v_curriculum_id,
      'detected',
      now(),
      v_rec.promotion_priority,
      jsonb_build_object(
        'readiness_score', v_rec.readiness_score,
        'source', 'wave_e_phase2',
        'qualification_catalog_id', v_rec.qualification_catalog_id,
        'course_id', v_course_id,
        'beruf_id', v_beruf_id
      )
    );

    -- Update draft
    IF v_rec.draft_row_id IS NOT NULL THEN
      UPDATE qualification_curriculum_drafts
      SET promoted_curriculum_id = v_curriculum_id, status = 'promoted', updated_at = now()
      WHERE id = v_rec.draft_row_id;
    END IF;

    -- Mark candidate promoted
    UPDATE qualification_wave_candidates
    SET candidate_status = 'promoted', promoted_at = now(), updated_at = now()
    WHERE id = v_rec.wc_id;

    v_promoted := v_promoted + 1;

    RAISE NOTICE 'Promoted: % (curriculum=%, course=%, beruf=%)', 
      v_rec.canonical_title, v_curriculum_id, v_course_id, v_beruf_id;
  END LOOP;

  RAISE NOTICE 'Phase 2 total promoted: %', v_promoted;
END;
$$;