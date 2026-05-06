CREATE OR REPLACE FUNCTION public.fn_package_gate_applicable(
  p_track text,
  p_gate text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_gate = 'gate_no_lessons'
      THEN upper(coalesce(p_track,'')) IN ('AUSBILDUNG_VOLL','EXAM_FIRST_PLUS','STUDIUM')
    WHEN p_gate = 'gate_no_minichecks'
      THEN upper(coalesce(p_track,'')) IN ('AUSBILDUNG_VOLL','STUDIUM')
    WHEN p_gate = 'gate_no_oral'
      THEN upper(coalesce(p_track,'')) IN ('AUSBILDUNG_VOLL')
    WHEN p_gate = 'gate_no_tutor_context'
      THEN upper(coalesce(p_track,'')) IN ('AUSBILDUNG_VOLL','EXAM_FIRST_PLUS','STUDIUM')
    ELSE true
  END;
$$;

INSERT INTO public.auto_heal_log
  (trigger_source, action_type, target_type, result_status, result_detail, metadata)
VALUES
  (
    'migration',
    'track_gate_matrix_calibrated_v2',
    'system',
    'ok',
    'Calibrated gate applicability to real course_packages.track values.',
    jsonb_build_object(
      'tracks', jsonb_build_array('AUSBILDUNG_VOLL','EXAM_FIRST','EXAM_FIRST_PLUS','STUDIUM'),
      'matrix', jsonb_build_object(
        'AUSBILDUNG_VOLL', jsonb_build_array('lessons','minichecks','oral','tutor_context'),
        'STUDIUM', jsonb_build_array('lessons','minichecks','tutor_context'),
        'EXAM_FIRST_PLUS', jsonb_build_array('lessons','tutor_context'),
        'EXAM_FIRST', jsonb_build_array()
      )
    )
  );