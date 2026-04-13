
-- Fix SSOT DAG drift in step_dag_edges
-- Three corrections to align with the canonical PIPELINE_GRAPH in job-map.ts / graph.ts

-- 1. repair_exam_pool_quality: wrong prereq validate_exam_pool → correct: generate_exam_pool
DELETE FROM step_dag_edges
WHERE step_key = 'repair_exam_pool_quality' AND depends_on = 'validate_exam_pool';

INSERT INTO step_dag_edges (step_key, depends_on)
VALUES ('repair_exam_pool_quality', 'generate_exam_pool')
ON CONFLICT DO NOTHING;

-- 2. generate_oral_exam: wrong prereq validate_exam_pool → correct: validate_tutor_index
DELETE FROM step_dag_edges
WHERE step_key = 'generate_oral_exam' AND depends_on = 'validate_exam_pool';

INSERT INTO step_dag_edges (step_key, depends_on)
VALUES ('generate_oral_exam', 'validate_tutor_index')
ON CONFLICT DO NOTHING;

-- 3. run_integrity_check: missing 4 of 5 dependencies (only had elite_harden)
INSERT INTO step_dag_edges (step_key, depends_on)
VALUES
  ('run_integrity_check', 'validate_lesson_minichecks'),
  ('run_integrity_check', 'validate_handbook_depth'),
  ('run_integrity_check', 'validate_oral_exam'),
  ('run_integrity_check', 'validate_tutor_index')
ON CONFLICT DO NOTHING;
