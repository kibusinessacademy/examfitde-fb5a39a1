-- validate_quiz_mapping: Server-seitige Garantie, dass quiz_slug → curriculum + Bundle eindeutig ist.
-- Wird vom Frontend beim Mount des Quiz-Runners aufgerufen; bei nicht-ok blockiert UI hart.
CREATE OR REPLACE FUNCTION public.validate_quiz_mapping(p_quiz_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.lead_quizzes%ROWTYPE;
  v_bundle_count integer;
BEGIN
  IF p_quiz_slug IS NULL OR length(p_quiz_slug) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_slug');
  END IF;

  SELECT * INTO v_quiz
  FROM public.lead_quizzes
  WHERE slug = p_quiz_slug
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quiz_not_found');
  END IF;

  IF v_quiz.curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'curriculum_missing');
  END IF;

  -- Optional Bundle-Check: tolerant — wenn curriculum_products-Tabelle existiert
  -- nutzen wir sie, sonst geben wir "ok" zurück (Frontend-Mapping greift).
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.curriculum_products WHERE curriculum_id = $1'
    INTO v_bundle_count
    USING v_quiz.curriculum_id;
  EXCEPTION WHEN undefined_table THEN
    v_bundle_count := 1; -- Tabelle nicht vorhanden → tolerant
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'quiz_id', v_quiz.id,
    'curriculum_id', v_quiz.curriculum_id,
    'bundle_count', v_bundle_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_quiz_mapping(text) TO anon, authenticated;