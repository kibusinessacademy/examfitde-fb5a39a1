UPDATE public.quality_rules
SET config = jsonb_build_object(
  'min', 850,
  'track_overrides', jsonb_build_object(
    'AUSBILDUNG_VOLL', 850,
    'EXAM_FIRST', 500,
    'EXAM_FIRST_PLUS', 600,
    'STUDIUM', 500
  )
)
WHERE rule_key = 'min_question_count';