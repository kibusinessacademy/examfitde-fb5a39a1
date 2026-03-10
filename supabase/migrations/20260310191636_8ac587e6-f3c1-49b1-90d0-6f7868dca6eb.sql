
-- P1: Scaffold 50 placeholder lessons for 10 missing K04 competencies
DO $$
DECLARE
  rec RECORD;
  steps TEXT[] := ARRAY['einstieg','verstehen','anwenden','wiederholen','mini_check'];
  step_label TEXT;
  si INT;
  base_sort INT;
BEGIN
  FOR rec IN
    SELECT c.id AS comp_id, c.code AS comp_code, c.title AS comp_title, c.sort_order AS comp_sort,
           m.id AS module_id
    FROM competencies c
    JOIN learning_fields lf ON c.learning_field_id = lf.id
    JOIN modules m ON m.learning_field_id = lf.id 
      AND m.course_id = 'ae943f8c-da2e-422e-af5f-d7ff721cbf0c'
    WHERE lf.curriculum_id = '63635f46-0186-49e7-80c1-67925dbdf638'
      AND c.code LIKE '%-K04'
      AND NOT EXISTS (
        SELECT 1 FROM lessons l 
        WHERE l.module_id = m.id AND l.competency_id = c.id
      )
  LOOP
    base_sort := COALESCE(rec.comp_sort, 4) * 5;
    FOR si IN 1..5 LOOP
      step_label := steps[si];
      INSERT INTO lessons (
        module_id, competency_id, title, step, content,
        duration_minutes, sort_order, weight_tag,
        exam_relevance_score, mastery_weight, minicheck_parsed
      ) VALUES (
        rec.module_id,
        rec.comp_id,
        rec.comp_code || ': ' || rec.comp_title,
        step_label::lesson_step,
        jsonb_build_object(
          'type', CASE WHEN step_label = 'mini_check' THEN 'mini_check' ELSE 'text' END,
          'html', '<h3>' || rec.comp_title || ' – ' || step_label || '</h3><p>⏳ Inhalt wird generiert...</p>',
          'objectives', jsonb_build_array('Verständnis von ' || rec.comp_title),
          '_placeholder', true
        ),
        CASE WHEN step_label = 'mini_check' THEN 5 ELSE 10 END,
        base_sort + si - 1,
        CASE 
          WHEN step_label IN ('mini_check', 'anwenden') THEN 'high'
          WHEN step_label = 'verstehen' THEN 'medium'
          ELSE 'low'
        END,
        30,
        CASE WHEN step_label = 'mini_check' THEN 1.0 ELSE 0 END,
        false
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Reset package to building and re-queue pipeline steps
UPDATE course_packages
SET status = 'building', integrity_passed = false
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04';

UPDATE package_steps
SET status = 'queued', last_error = NULL, 
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{reset_reason}', '"k04_competency_scaffold"')
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key IN (
    'generate_learning_content', 'validate_learning_content',
    'generate_lesson_minichecks', 'validate_lesson_minichecks',
    'generate_exam_pool', 'validate_exam_pool',
    'build_ai_tutor_index', 'validate_tutor_index',
    'run_integrity_check', 'quality_council', 'auto_publish'
  );
