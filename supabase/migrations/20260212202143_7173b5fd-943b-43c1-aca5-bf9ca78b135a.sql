
-- Drop old signature
DROP FUNCTION IF EXISTS public.validate_course_integrity_v2(uuid, uuid, jsonb);

-- Recreate with simple signature: only curriculum_id
CREATE OR REPLACE FUNCTION public.validate_course_integrity_v2(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_total int := 0;
  v_oral_total int := 0;
  v_handbook_chapters int := 0;
  v_handbook_sections int := 0;
  v_tutor_index boolean := false;

  v_target_exam int := 1000;
  v_target_oral int := 20;
  v_target_handbook_chapters int := 5;
  v_target_handbook_sections int := 10;

  v_score numeric := 0;
  v_passed boolean := false;
BEGIN
  -- EXAM total
  SELECT count(*)::int INTO v_exam_total
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id;

  -- ORAL
  SELECT count(*)::int INTO v_oral_total
  FROM public.oral_exam_blueprints
  WHERE curriculum_id = p_curriculum_id;

  -- HANDBOOK
  SELECT count(*)::int INTO v_handbook_chapters
  FROM public.handbook_chapters
  WHERE curriculum_id = p_curriculum_id;

  SELECT count(*)::int INTO v_handbook_sections
  FROM public.handbook_sections hs
  JOIN public.handbook_chapters hc ON hc.id = hs.chapter_id
  WHERE hc.curriculum_id = p_curriculum_id;

  -- AI TUTOR INDEX
  SELECT EXISTS(
    SELECT 1 FROM public.ai_tutor_context_index
    WHERE package_id IN (
      SELECT cp.id FROM public.course_packages cp
      JOIN public.courses c ON c.id = cp.course_id
      WHERE c.curriculum_id = p_curriculum_id
    )
  ) INTO v_tutor_index;

  -- SCORE calculation (weighted)
  v_score :=
    (
      least(v_exam_total::numeric / nullif(v_target_exam, 0), 1) * 0.50
      + least(v_oral_total::numeric / nullif(v_target_oral, 0), 1) * 0.15
      + least(v_handbook_chapters::numeric / nullif(v_target_handbook_chapters, 0), 1) * 0.15
      + least(v_handbook_sections::numeric / nullif(v_target_handbook_sections, 0), 1) * 0.10
      + CASE WHEN v_tutor_index THEN 0.10 ELSE 0 END
    ) * 100;

  v_passed := v_score >= 85;

  RETURN jsonb_build_object(
    'curriculum_id', p_curriculum_id,
    'score', round(v_score, 0),
    'passed', v_passed,
    'exam', jsonb_build_object('total', v_exam_total, 'target', v_target_exam),
    'oral', jsonb_build_object('total', v_oral_total, 'target', v_target_oral),
    'handbook', jsonb_build_object(
      'chapters', v_handbook_chapters,
      'sections', v_handbook_sections,
      'target', v_target_handbook_chapters,
      'target_sections', v_target_handbook_sections
    ),
    'tutor_index', v_tutor_index,
    'policy_version', 6
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_course_integrity_v2(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_course_integrity_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_course_integrity_v2(uuid) TO service_role;
