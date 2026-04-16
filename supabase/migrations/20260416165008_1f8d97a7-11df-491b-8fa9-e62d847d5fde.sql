
-- 1. Publish Guard: prevents publishing packages with missing mandatory artifacts
CREATE OR REPLACE FUNCTION public.fn_guard_publish_requires_artifacts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_track text;
  v_curriculum_id uuid;
  v_approved_q int;
  v_tutor_idx int;
  v_oral_bp int;
  v_hb_ch int;
  v_missing text[];
BEGIN
  -- Only fire on transition TO published
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    
    -- Allow emergency bypass
    IF (NEW.meta->>'emergency_bypass')::boolean = true THEN
      RETURN NEW;
    END IF;

    v_track := NEW.track;
    v_curriculum_id := NEW.curriculum_id;

    -- Check approved questions (required for ALL tracks)
    SELECT count(*) INTO v_approved_q
    FROM exam_questions WHERE curriculum_id = v_curriculum_id AND status = 'approved';
    IF v_approved_q < 50 THEN
      v_missing := array_append(v_missing, 'EXAM_POOL: only ' || v_approved_q || ' approved questions (min 50)');
    END IF;

    -- Check tutor index (required for ALL tracks)
    SELECT count(*) INTO v_tutor_idx
    FROM ai_tutor_context_index WHERE package_id = NEW.id;
    IF v_tutor_idx = 0 THEN
      v_missing := array_append(v_missing, 'TUTOR_INDEX: no tutor index built');
    END IF;

    -- EXAM_FIRST_PLUS and AUSBILDUNG_VOLL need handbook
    IF v_track IN ('EXAM_FIRST_PLUS', 'AUSBILDUNG_VOLL', 'STUDIUM') THEN
      SELECT count(*) INTO v_hb_ch
      FROM handbook_chapters WHERE curriculum_id = v_curriculum_id;
      IF v_hb_ch = 0 THEN
        v_missing := array_append(v_missing, 'HANDBOOK: no handbook chapters');
      END IF;
    END IF;

    -- AUSBILDUNG_VOLL needs oral exam
    IF v_track = 'AUSBILDUNG_VOLL' THEN
      SELECT count(*) INTO v_oral_bp
      FROM oral_exam_blueprints WHERE curriculum_id = v_curriculum_id;
      IF v_oral_bp = 0 THEN
        v_missing := array_append(v_missing, 'ORAL_EXAM: no oral exam blueprints');
      END IF;
    END IF;

    IF array_length(v_missing, 1) > 0 THEN
      RAISE EXCEPTION 'HOLLOW_PUBLISH_BLOCKED: Package % cannot be published. Missing artifacts: %', 
        NEW.id, array_to_string(v_missing, '; ');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger (before update, so it blocks the transition)
DROP TRIGGER IF EXISTS trg_guard_publish_requires_artifacts ON course_packages;
CREATE TRIGGER trg_guard_publish_requires_artifacts
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_publish_requires_artifacts();

-- 2. Hollow Completion Ops View
CREATE OR REPLACE VIEW ops_hollow_completion AS
SELECT 
  cp.id as package_id,
  LEFT(cp.id::text, 8) as short_id,
  c.title,
  cp.status,
  cp.track,
  cp.build_progress,
  (SELECT count(*) FROM package_steps ps WHERE ps.package_id = cp.id AND ps.status = 'done') as steps_done,
  (SELECT count(*) FROM package_steps ps WHERE ps.package_id = cp.id) as steps_total,
  (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.status = 'approved') as approved_questions,
  (SELECT count(*) FROM ai_tutor_context_index ti WHERE ti.package_id = cp.id) as tutor_indices,
  (SELECT count(*) FROM oral_exam_blueprints ob WHERE ob.curriculum_id = cp.curriculum_id) as oral_blueprints,
  (SELECT count(*) FROM handbook_chapters hc WHERE hc.curriculum_id = cp.curriculum_id) as handbook_chapters,
  CASE 
    WHEN (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.status = 'approved') < 50 THEN true
    ELSE false
  END as missing_exam_pool,
  CASE 
    WHEN (SELECT count(*) FROM ai_tutor_context_index ti WHERE ti.package_id = cp.id) = 0 THEN true
    ELSE false
  END as missing_tutor,
  CASE 
    WHEN cp.track IN ('AUSBILDUNG_VOLL') AND (SELECT count(*) FROM oral_exam_blueprints ob WHERE ob.curriculum_id = cp.curriculum_id) = 0 THEN true
    ELSE false
  END as missing_oral,
  CASE 
    WHEN cp.track IN ('EXAM_FIRST_PLUS', 'AUSBILDUNG_VOLL', 'STUDIUM') AND (SELECT count(*) FROM handbook_chapters hc WHERE hc.curriculum_id = cp.curriculum_id) = 0 THEN true
    ELSE false
  END as missing_handbook
FROM course_packages cp
JOIN courses c ON c.id = cp.course_id
WHERE cp.build_progress >= 90
  AND (
    (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.status = 'approved') < 50
    OR (SELECT count(*) FROM ai_tutor_context_index ti WHERE ti.package_id = cp.id) = 0
    OR (cp.track = 'AUSBILDUNG_VOLL' AND (SELECT count(*) FROM oral_exam_blueprints ob WHERE ob.curriculum_id = cp.curriculum_id) = 0)
    OR (cp.track IN ('EXAM_FIRST_PLUS', 'AUSBILDUNG_VOLL', 'STUDIUM') AND (SELECT count(*) FROM handbook_chapters hc WHERE hc.curriculum_id = cp.curriculum_id) = 0)
  );

-- Grant access
GRANT SELECT ON ops_hollow_completion TO authenticated;
