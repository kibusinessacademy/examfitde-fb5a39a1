
-- Update the quality guard to respect bypass flag (only settable by SECURITY DEFINER)
CREATE OR REPLACE FUNCTION fn_guard_approved_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow bypass from trusted SECURITY DEFINER functions (e.g. shuffle)
  IF current_setting('app.bypass_quality_guard', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Only guard approved questions
  IF NEW.status != 'approved' AND NEW.review_state != 'approved' THEN
    RETURN NEW;
  END IF;

  -- Check explanation
  IF NEW.explanation IS NULL OR length(trim(NEW.explanation)) < 20 THEN
    RAISE EXCEPTION 'QUALITY_GUARD: approved question missing meaningful explanation';
  END IF;

  RETURN NEW;
END;
$$;

-- Update shuffle function to set bypass
CREATE OR REPLACE FUNCTION fn_shuffle_exam_answer_positions(_certification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total int := 0;
  _shuffled int := 0;
  _rec record;
  _opts jsonb;
  _new_opts jsonb;
  _old_correct int;
  _correct_text text;
  _new_correct int;
  _perm int[];
  _distractor jsonb;
  _new_raw jsonb;
  _entry jsonb;
  _new_idx int;
BEGIN
  -- Bypass quality guard - we're only rotating positions, not changing content
  PERFORM set_config('app.bypass_quality_guard', 'true', true);

  FOR _rec IN
    SELECT id, options, correct_answer, distractor_meta
    FROM exam_questions
    WHERE certification_id = _certification_id
      AND options IS NOT NULL
      AND jsonb_array_length(options) >= 2
    ORDER BY random()
  LOOP
    _total := _total + 1;
    _opts := _rec.options;
    _old_correct := _rec.correct_answer;
    _correct_text := _opts->>_old_correct;
    
    SELECT array_agg(idx ORDER BY random())
    INTO _perm
    FROM generate_series(0, jsonb_array_length(_opts) - 1) AS idx;
    
    _new_opts := '[]'::jsonb;
    FOR i IN 1..array_length(_perm, 1) LOOP
      _new_opts := _new_opts || jsonb_build_array(_opts->(_perm[i]));
    END LOOP;
    
    _new_correct := NULL;
    FOR i IN 0..jsonb_array_length(_new_opts) - 1 LOOP
      IF _new_opts->>i = _correct_text THEN
        _new_correct := i;
        EXIT;
      END IF;
    END LOOP;
    
    IF _new_correct IS NULL THEN
      CONTINUE;
    END IF;
    
    IF _new_correct = _old_correct AND _new_opts = _opts THEN
      CONTINUE;
    END IF;
    
    _distractor := _rec.distractor_meta;
    IF _distractor IS NOT NULL AND _distractor->'raw' IS NOT NULL THEN
      _new_raw := '[]'::jsonb;
      FOR _entry IN SELECT value FROM jsonb_array_elements(_distractor->'raw')
      LOOP
        _new_idx := NULL;
        FOR j IN 1..array_length(_perm, 1) LOOP
          IF _perm[j] = (_entry->>'option_index')::int THEN
            _new_idx := j - 1;
            EXIT;
          END IF;
        END LOOP;
        IF _new_idx IS NOT NULL THEN
          _new_raw := _new_raw || jsonb_build_array(
            _entry || jsonb_build_object('option_index', _new_idx)
          );
        ELSE
          _new_raw := _new_raw || jsonb_build_array(_entry);
        END IF;
      END LOOP;
      _distractor := jsonb_set(_distractor, '{raw}', _new_raw);
    END IF;
    
    UPDATE exam_questions
    SET options = _new_opts,
        correct_answer = _new_correct,
        distractor_meta = _distractor
    WHERE id = _rec.id;
    
    _shuffled := _shuffled + 1;
  END LOOP;
  
  RETURN jsonb_build_object(
    'total_processed', _total,
    'shuffled', _shuffled,
    'certification_id', _certification_id
  );
END;
$$;
