
-- ═══════════════════════════════════════════════════════════
-- 1. Answer-Position-Shuffle function (for bulk repair)
-- ═══════════════════════════════════════════════════════════

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
    
    -- Get correct answer text
    _correct_text := _opts->>_old_correct;
    
    -- Generate a random permutation using Fisher-Yates
    -- Simple approach: rebuild with random order
    SELECT array_agg(idx ORDER BY random())
    INTO _perm
    FROM generate_series(0, jsonb_array_length(_opts) - 1) AS idx;
    
    -- Build new options array following permutation
    _new_opts := '[]'::jsonb;
    FOR i IN 1..array_length(_perm, 1) LOOP
      _new_opts := _new_opts || jsonb_build_array(_opts->(_perm[i]));
    END LOOP;
    
    -- Find new position of correct answer
    _new_correct := NULL;
    FOR i IN 0..jsonb_array_length(_new_opts) - 1 LOOP
      IF _new_opts->>i = _correct_text THEN
        _new_correct := i;
        EXIT;
      END IF;
    END LOOP;
    
    IF _new_correct IS NULL THEN
      CONTINUE; -- safety: skip if something went wrong
    END IF;
    
    -- Skip if nothing changed
    IF _new_correct = _old_correct AND _new_opts = _opts THEN
      CONTINUE;
    END IF;
    
    -- Update distractor_meta.raw option_index values
    _distractor := _rec.distractor_meta;
    IF _distractor IS NOT NULL AND _distractor->'raw' IS NOT NULL THEN
      _new_raw := '[]'::jsonb;
      FOR _entry IN SELECT value FROM jsonb_array_elements(_distractor->'raw')
      LOOP
        -- Find old option_index in permutation to get new index
        _new_idx := NULL;
        FOR j IN 1..array_length(_perm, 1) LOOP
          IF _perm[j] = (_entry->>'option_index')::int THEN
            _new_idx := j - 1; -- 0-based
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
    
    -- Apply update
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

-- ═══════════════════════════════════════════════════════════
-- 2. Auto-shuffle on INSERT (Dauermaßnahme: Generator-Fix)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_randomize_new_exam_answer_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _opts jsonb;
  _correct_text text;
  _perm int[];
  _new_opts jsonb;
  _new_correct int;
  _distractor jsonb;
  _new_raw jsonb;
  _entry jsonb;
  _new_idx int;
BEGIN
  IF NEW.options IS NULL OR jsonb_array_length(NEW.options) < 2 THEN
    RETURN NEW;
  END IF;
  
  _opts := NEW.options;
  _correct_text := _opts->>NEW.correct_answer;
  
  SELECT array_agg(idx ORDER BY random())
  INTO _perm
  FROM generate_series(0, jsonb_array_length(_opts) - 1) AS idx;
  
  _new_opts := '[]'::jsonb;
  FOR i IN 1..array_length(_perm, 1) LOOP
    _new_opts := _new_opts || jsonb_build_array(_opts->(_perm[i]));
  END LOOP;
  
  FOR i IN 0..jsonb_array_length(_new_opts) - 1 LOOP
    IF _new_opts->>i = _correct_text THEN
      _new_correct := i;
      EXIT;
    END IF;
  END LOOP;
  
  IF _new_correct IS NULL THEN
    RETURN NEW;
  END IF;
  
  NEW.options := _new_opts;
  NEW.correct_answer := _new_correct;
  
  -- Also fix distractor_meta if present
  IF NEW.distractor_meta IS NOT NULL AND NEW.distractor_meta->'raw' IS NOT NULL THEN
    _new_raw := '[]'::jsonb;
    FOR _entry IN SELECT value FROM jsonb_array_elements(NEW.distractor_meta->'raw')
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
    NEW.distractor_meta := jsonb_set(NEW.distractor_meta, '{raw}', _new_raw);
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_randomize_exam_answer_position ON exam_questions;
CREATE TRIGGER trg_randomize_exam_answer_position
  BEFORE INSERT ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_randomize_new_exam_answer_position();

-- ═══════════════════════════════════════════════════════════
-- 3. Governance-Konsistenz-View (Dauermaßnahme)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops_governance_consistency AS
SELECT 
  ps.package_id,
  cp.title as package_title,
  cp.status as package_status,
  ps.step_key,
  ps.status as step_status,
  ps.last_error,
  ps.attempts,
  ps.exception_approved,
  ps.exception_reason,
  CASE
    WHEN ps.status = 'done' AND ps.last_error IS NOT NULL AND NOT COALESCE(ps.exception_approved, false)
    THEN 'GOVERNANCE_DRIFT'
    WHEN ps.status = 'done' AND ps.last_error IS NOT NULL AND COALESCE(ps.exception_approved, false)
    THEN 'APPROVED_OVERRIDE'
    ELSE 'CLEAN'
  END as governance_class
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.status = 'done' AND ps.last_error IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 4. Oral-Exam-Fanout-Completeness Guard (Dauermaßnahme)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_guard_oral_exam_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total_comps int;
  _covered_comps int;
  _cert_id uuid;
  _cur_id uuid;
BEGIN
  -- Only guard the generate_oral_exam step transitioning to done
  IF NEW.step_key != 'generate_oral_exam' THEN
    RETURN NEW;
  END IF;
  IF NEW.status != 'done' OR OLD.status = 'done' THEN
    RETURN NEW;
  END IF;
  
  -- Allow exception-approved overrides
  IF COALESCE(NEW.exception_approved, false) THEN
    RETURN NEW;
  END IF;
  
  -- Get certification
  SELECT cp.certification_id INTO _cert_id
  FROM course_packages cp WHERE cp.id = NEW.package_id;
  
  SELECT c.id INTO _cur_id
  FROM curricula c WHERE c.certification_id = _cert_id LIMIT 1;
  
  IF _cur_id IS NULL THEN
    RETURN NEW; -- no curriculum, skip guard
  END IF;
  
  SELECT COUNT(*) INTO _total_comps
  FROM competencies
  WHERE learning_field_id IN (SELECT id FROM learning_fields WHERE curriculum_id = _cur_id);
  
  SELECT COUNT(DISTINCT competency_id) INTO _covered_comps
  FROM oral_exam_blueprints
  WHERE curriculum_id = _cur_id AND competency_id IS NOT NULL;
  
  IF _total_comps > 0 AND _covered_comps < _total_comps THEN
    RAISE EXCEPTION 'ORAL_EXAM_INCOMPLETE: only %/% competencies covered by oral exam blueprints', 
      _covered_comps, _total_comps;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_oral_exam_completeness ON package_steps;
CREATE TRIGGER trg_guard_oral_exam_completeness
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_oral_exam_completeness();
