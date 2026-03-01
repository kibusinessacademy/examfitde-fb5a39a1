
CREATE OR REPLACE FUNCTION public.check_lesson_answer(p_lesson_id UUID, p_user_answer TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key RECORD;
  v_answer_lower TEXT;
  v_found_keywords TEXT[] := '{}';
  v_missing_keywords TEXT[] := '{}';
  v_found_checklist TEXT[] := '{}';
  v_missing_checklist TEXT[] := '{}';
  v_kw TEXT;
  v_ci TEXT;
  v_ci_words TEXT[];
  v_ci_matched BOOLEAN;
  v_word TEXT;
  v_keyword_score NUMERIC := 0;
  v_checklist_score NUMERIC := 0;
  v_total_score NUMERIC := 0;
  v_found_kw_count INT;
  v_found_cl_count INT;
BEGIN
  SELECT * INTO v_key FROM lesson_answer_keys WHERE lesson_id = p_lesson_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no_answer_key', 'message', 'Für diese Lektion ist noch keine Musterlösung hinterlegt.');
  END IF;

  v_answer_lower := lower(p_user_answer);

  -- Keyword matching (case-insensitive substring)
  IF array_length(v_key.keywords, 1) IS NOT NULL THEN
    FOREACH v_kw IN ARRAY v_key.keywords LOOP
      IF v_answer_lower LIKE '%' || lower(v_kw) || '%' THEN
        v_found_keywords := array_append(v_found_keywords, v_kw);
      ELSE
        v_missing_keywords := array_append(v_missing_keywords, v_kw);
      END IF;
    END LOOP;
    v_found_kw_count := COALESCE(array_length(v_found_keywords, 1), 0);
    v_keyword_score := round(v_found_kw_count::NUMERIC / array_length(v_key.keywords, 1)::NUMERIC * 100);
  END IF;

  -- Checklist matching: check if ANY significant word (>3 chars) from the checklist item appears
  IF array_length(v_key.checklist, 1) IS NOT NULL THEN
    FOREACH v_ci IN ARRAY v_key.checklist LOOP
      v_ci_words := string_to_array(lower(v_ci), ' ');
      v_ci_matched := FALSE;
      FOREACH v_word IN ARRAY v_ci_words LOOP
        -- Only check words longer than 3 characters (skip articles, prepositions)
        IF length(v_word) > 3 AND v_answer_lower LIKE '%' || v_word || '%' THEN
          v_ci_matched := TRUE;
          EXIT;
        END IF;
      END LOOP;
      IF v_ci_matched THEN
        v_found_checklist := array_append(v_found_checklist, v_ci);
      ELSE
        v_missing_checklist := array_append(v_missing_checklist, v_ci);
      END IF;
    END LOOP;
    v_found_cl_count := COALESCE(array_length(v_found_checklist, 1), 0);
    v_checklist_score := round(v_found_cl_count::NUMERIC / array_length(v_key.checklist, 1)::NUMERIC * 100);
  END IF;

  v_total_score := round(v_keyword_score * 0.6 + v_checklist_score * 0.4);

  RETURN jsonb_build_object(
    'score', v_total_score,
    'keyword_score', v_keyword_score,
    'checklist_score', v_checklist_score,
    'found_keywords', to_jsonb(v_found_keywords),
    'missing_keywords', to_jsonb(v_missing_keywords),
    'found_checklist', to_jsonb(v_found_checklist),
    'missing_checklist', to_jsonb(v_missing_checklist),
    'has_exemplar', true
  );
END;
$$;
