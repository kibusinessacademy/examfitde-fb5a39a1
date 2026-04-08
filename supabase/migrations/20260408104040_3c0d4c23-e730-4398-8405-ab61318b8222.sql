
-- FI Core LF Equivalence Mapping
CREATE TABLE IF NOT EXISTS public.fi_core_lf_equivalence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lf_code text NOT NULL,
  curriculum_id uuid NOT NULL,
  learning_field_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (curriculum_id, lf_code)
);

-- No RLS needed - internal pipeline table
ALTER TABLE public.fi_core_lf_equivalence ENABLE ROW LEVEL SECURITY;

-- The 4 active FI curriculum IDs
-- AE: a8a6340d-fd50-445f-a55b-7d5a6c72e2e1
-- SI: 53d13046-88bf-42bf-9a2e-05d5e4a4f272
-- DPA: e52eab02-5f89-46ba-b3d5-3b16948f5ec3
-- DV: cdb12a5a-2c21-408a-8879-ef5afa52057d

CREATE OR REPLACE FUNCTION public.fn_populate_fi_lf_equivalence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fi_curricula uuid[] := ARRAY[
    'a8a6340d-fd50-445f-a55b-7d5a6c72e2e1'::uuid,
    '53d13046-88bf-42bf-9a2e-05d5e4a4f272'::uuid,
    'e52eab02-5f89-46ba-b3d5-3b16948f5ec3'::uuid,
    'cdb12a5a-2c21-408a-8879-ef5afa52057d'::uuid
  ];
  v_shared_lfs text[] := ARRAY['LF01','LF02','LF03','LF04','LF05','LF06','LF07','LF08'];
  v_inserted int := 0;
BEGIN
  INSERT INTO fi_core_lf_equivalence (lf_code, curriculum_id, learning_field_id)
  SELECT lf.code, lf.curriculum_id, lf.id
  FROM learning_fields lf
  WHERE lf.curriculum_id = ANY(v_fi_curricula)
    AND lf.code = ANY(v_shared_lfs)
  ON CONFLICT (curriculum_id, lf_code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_inserted, 'curricula', array_length(v_fi_curricula, 1));
END;
$$;

-- Share questions across FI curricula for core LFs
CREATE OR REPLACE FUNCTION public.fn_share_fi_core_questions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lf_code text;
  v_total_shared int := 0;
  v_lf_shared int;
  v_source_lf_id uuid;
  v_source_curriculum uuid;
  v_target record;
  v_details jsonb := '[]'::jsonb;
BEGIN
  -- Ensure mapping is populated
  PERFORM fn_populate_fi_lf_equivalence();

  -- For each shared LF code
  FOR v_lf_code IN SELECT DISTINCT lf_code FROM fi_core_lf_equivalence ORDER BY lf_code
  LOOP
    -- Find the richest source (most approved questions)
    SELECT e.learning_field_id, e.curriculum_id
    INTO v_source_lf_id, v_source_curriculum
    FROM fi_core_lf_equivalence e
    JOIN LATERAL (
      SELECT COUNT(*) as cnt
      FROM exam_questions eq
      WHERE eq.learning_field_id = e.learning_field_id
        AND eq.status = 'approved'
    ) q ON true
    ORDER BY q.cnt DESC
    LIMIT 1;

    IF v_source_lf_id IS NULL THEN CONTINUE; END IF;

    -- Copy to each target curriculum that has fewer questions
    FOR v_target IN
      SELECT e.learning_field_id as target_lf_id, e.curriculum_id as target_curriculum
      FROM fi_core_lf_equivalence e
      WHERE e.lf_code = v_lf_code
        AND e.curriculum_id != v_source_curriculum
    LOOP
      v_lf_shared := 0;

      INSERT INTO exam_questions (
        curriculum_id, learning_field_id, competency_id,
        question_text, options, correct_answer, explanation,
        difficulty, status, ai_generated, cognitive_level,
        question_type, trap_tags, distractor_meta, exam_part,
        normalized_hash, blueprint_id
      )
      SELECT
        v_target.target_curriculum,
        v_target.target_lf_id,
        -- Map competency: find matching competency in target by title
        (SELECT tc.id FROM competencies tc
         WHERE tc.learning_field_id = v_target.target_lf_id
           AND tc.title = sc.title
         LIMIT 1),
        eq.question_text, eq.options, eq.correct_answer, eq.explanation,
        eq.difficulty, eq.status, true, eq.cognitive_level,
        eq.question_type, eq.trap_tags, eq.distractor_meta, eq.exam_part,
        eq.normalized_hash, NULL
      FROM exam_questions eq
      LEFT JOIN competencies sc ON sc.id = eq.competency_id
      WHERE eq.learning_field_id = v_source_lf_id
        AND eq.status = 'approved'
        -- Avoid duplicates by normalized_hash
        AND NOT EXISTS (
          SELECT 1 FROM exam_questions ex2
          WHERE ex2.curriculum_id = v_target.target_curriculum
            AND ex2.normalized_hash = eq.normalized_hash
            AND eq.normalized_hash IS NOT NULL
        )
        -- Also avoid text duplicates
        AND NOT EXISTS (
          SELECT 1 FROM exam_questions ex3
          WHERE ex3.learning_field_id = v_target.target_lf_id
            AND ex3.question_text = eq.question_text
        );

      GET DIAGNOSTICS v_lf_shared = ROW_COUNT;
      v_total_shared := v_total_shared + v_lf_shared;

      IF v_lf_shared > 0 THEN
        v_details := v_details || jsonb_build_object(
          'lf_code', v_lf_code,
          'target_curriculum', v_target.target_curriculum,
          'shared', v_lf_shared
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'total_shared', v_total_shared,
    'details', v_details
  );
END;
$$;

-- Virtual pool merge: get questions from ALL equivalent FI LFs
CREATE OR REPLACE FUNCTION public.fn_get_fi_equivalent_questions(p_learning_field_id uuid)
RETURNS SETOF exam_questions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT eq.*
  FROM fi_core_lf_equivalence source
  JOIN fi_core_lf_equivalence target ON target.lf_code = source.lf_code
  JOIN exam_questions eq ON eq.learning_field_id = target.learning_field_id
  WHERE source.learning_field_id = p_learning_field_id
    AND eq.status = 'approved';
$$;
