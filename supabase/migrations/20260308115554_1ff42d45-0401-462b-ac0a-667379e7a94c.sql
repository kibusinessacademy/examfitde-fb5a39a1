
CREATE OR REPLACE FUNCTION public.promote_wave_candidates_to_factory(p_limit int DEFAULT 2)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_curriculum_id uuid;
  v_course_id uuid;
  v_promoted int := 0;
  v_results jsonb := '[]'::jsonb;
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
    LIMIT p_limit
  LOOP
    IF v_rec.promoted_curriculum_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    -- Map education_type to valid curriculum_typ
    v_curriculum_typ := CASE
      WHEN v_rec.education_type ILIKE '%fortbildung%' THEN 'fortbildung'
      WHEN v_rec.education_type ILIKE '%schulisch%' THEN 'schulisch'
      ELSE 'betrieblich'
    END;

    INSERT INTO curricula (title, description, status, curriculum_typ)
    VALUES (
      initcap(v_rec.draft_title),
      'Auto-generated from Wave E candidate: ' || v_rec.canonical_title,
      'draft',
      v_curriculum_typ
    )
    RETURNING id INTO v_curriculum_id;

    INSERT INTO courses (curriculum_id, title, description, status, autopilot_status)
    VALUES (
      v_curriculum_id,
      initcap(v_rec.draft_title),
      'Kurs für ' || initcap(v_rec.canonical_title),
      'draft',
      'idle'
    )
    RETURNING id INTO v_course_id;

    INSERT INTO factory_intake_queue (curriculum_id, intake_status, detected_at, priority_score, readiness_snapshot)
    VALUES (
      v_curriculum_id,
      'detected',
      now(),
      v_rec.promotion_priority,
      jsonb_build_object(
        'readiness_score', v_rec.readiness_score,
        'source', 'wave_e_promotion',
        'qualification_catalog_id', v_rec.qualification_catalog_id,
        'course_id', v_course_id
      )
    );

    IF v_rec.draft_row_id IS NOT NULL THEN
      UPDATE qualification_curriculum_drafts
      SET promoted_curriculum_id = v_curriculum_id, status = 'promoted', updated_at = now()
      WHERE id = v_rec.draft_row_id;
    END IF;

    UPDATE qualification_wave_candidates
    SET candidate_status = 'promoted', promoted_at = now(), updated_at = now()
    WHERE id = v_rec.wc_id;

    v_promoted := v_promoted + 1;
    v_results := v_results || jsonb_build_object(
      'canonical_title', v_rec.canonical_title,
      'curriculum_id', v_curriculum_id,
      'course_id', v_course_id
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'promoted', v_promoted, 'items', v_results);
END;
$$;
