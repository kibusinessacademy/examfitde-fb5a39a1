
-- Auto-seed function: distributes weight equally, infers difficulty from LF naming patterns
CREATE OR REPLACE FUNCTION public.auto_seed_lf_weights()
RETURNS TABLE(curriculum_id UUID, seeded_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur RECORD;
  lf RECORD;
  lf_count INT;
  base_weight NUMERIC;
  remainder NUMERIC;
  idx INT;
  diff_tier TEXT;
  e_part TEXT;
BEGIN
  FOR cur IN
    SELECT DISTINCT lf2.curriculum_id
    FROM learning_fields lf2
    WHERE (lf2.weight_percent IS NULL OR lf2.weight_percent = 0)
  LOOP
    -- Count LFs for this curriculum
    SELECT COUNT(*) INTO lf_count
    FROM learning_fields
    WHERE learning_fields.curriculum_id = cur.curriculum_id;

    IF lf_count = 0 THEN CONTINUE; END IF;

    base_weight := ROUND(100.0 / lf_count, 1);
    remainder := 100.0 - (base_weight * lf_count);
    idx := 0;

    FOR lf IN
      SELECT id, title, code
      FROM learning_fields
      WHERE learning_fields.curriculum_id = cur.curriculum_id
        AND (weight_percent IS NULL OR weight_percent = 0)
      ORDER BY code
    LOOP
      idx := idx + 1;

      -- Infer difficulty from title keywords
      diff_tier := 'medium';
      IF lf.title ~* '(Rechnungswesen|Buchführung|Kalkulation|Finanz|Controlling|Steuer|Bilanz|Kosten|Liquidität|Werteströme|Investition)'
      THEN diff_tier := 'hard';
      ELSIF lf.title ~* '(Recht|Gesetz|Vertrag|Haftung|Compliance|Regulierung|Datenschutz)'
      THEN diff_tier := 'hard';
      ELSIF lf.title ~* '(Projekt|Fachgespräch|Präsentation|Prüfung)'
      THEN diff_tier := 'hard';
      ELSIF lf.title ~* '(Sicherheit|Umweltschutz|Arbeitsschutz|Gesundheitsschutz)'
      THEN diff_tier := 'easy';
      ELSIF lf.title ~* '(Organisation|Aufbau|Berufsbildung|Tarifrecht)'
      THEN diff_tier := 'easy';
      END IF;

      -- Infer exam_part from code pattern
      e_part := NULL;
      IF lf.code ~* '^(LF0[1-6]|WQ|HF[12])' THEN e_part := 'teil_1';
      ELSIF lf.code ~* '^(LF(0[7-9]|1[0-9])|HQ|HF[34])' THEN e_part := 'teil_2';
      END IF;

      UPDATE learning_fields SET
        weight_percent = CASE WHEN idx = 1 THEN base_weight + remainder ELSE base_weight END,
        difficulty_tier = diff_tier,
        exam_part = COALESCE(learning_fields.exam_part, e_part)
      WHERE learning_fields.id = lf.id;
    END LOOP;

    curriculum_id := cur.curriculum_id;
    seeded_count := idx;
    RETURN NEXT;
  END LOOP;
END;
$$;
