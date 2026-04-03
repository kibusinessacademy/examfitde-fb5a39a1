
-- 1. Create course for WiInfo
INSERT INTO public.courses (id, curriculum_id, title, description, status)
VALUES (
  'c4000000-0004-4000-8000-000000000001',
  'c2000000-0004-4000-8000-000000000001',
  'ExamFit – Wirtschaftsinformatik Bachelor',
  'Modulprüfungen Bachelor Wirtschaftsinformatik',
  'draft'
);

-- 2. Create course package
INSERT INTO public.course_packages (
  id, curriculum_id, course_id, certification_id, title, status,
  certification_type, track, priority,
  feature_flags, components
) VALUES (
  'c5000000-0004-4000-8000-000000000001',
  'c2000000-0004-4000-8000-000000000001',
  'c4000000-0004-4000-8000-000000000001',
  'c3000000-0004-4000-8000-000000000001',
  'ExamFit – Wirtschaftsinformatik Bachelor',
  'planning',
  'studium',
  'STUDIUM',
  2,
  '{
    "has_handbook": true,
    "has_minichecks": true,
    "has_ai_tutor": true,
    "has_exam_trainer": true,
    "has_exam_simulation": true,
    "has_learning_course": true,
    "has_oral_exam_trainer": true,
    "has_practice_course_h5p": false,
    "ai_tutor_mode": "full_studium"
  }'::jsonb,
  '{
    "ai_tutor": true,
    "handbook": true,
    "oral_exam": true,
    "exam_trainer": true,
    "learning_course": true
  }'::jsonb
);

-- 3. Seed ALL pipeline steps (SSOT-konform, including variant steps)
INSERT INTO public.package_steps (package_id, step_key, status, meta) VALUES
  ('c5000000-0004-4000-8000-000000000001', 'scaffold_learning_course', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'generate_glossary', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'fanout_learning_content', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'generate_learning_content', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'finalize_learning_content', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_learning_content', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'auto_seed_exam_blueprints', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_blueprints', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'generate_blueprint_variants', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_blueprint_variants', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'promote_blueprint_variants', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'generate_exam_pool', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_exam_pool', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'build_ai_tutor_index', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_tutor_index', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'generate_oral_exam', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_oral_exam', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'generate_lesson_minichecks', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_lesson_minichecks', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'generate_handbook', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_handbook', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'enqueue_handbook_expand', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'expand_handbook', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'validate_handbook_depth', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'elite_harden', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'run_integrity_check', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'quality_council', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb),
  ('c5000000-0004-4000-8000-000000000001', 'auto_publish', 'queued', '{"seeded_by":"e2e_bootstrap"}'::jsonb)
ON CONFLICT (package_id, step_key) DO NOTHING;

-- 4. Enqueue curriculum ingest job (with package_id to satisfy trigger)
INSERT INTO public.job_queue (job_type, status, payload, max_attempts, priority, package_id)
VALUES (
  'package_curriculum_ingest',
  'pending',
  jsonb_build_object(
    'curriculum_id', 'c2000000-0004-4000-8000-000000000001',
    'catalog_id', 'c3000000-0004-4000-8000-000000000001',
    'package_id', 'c5000000-0004-4000-8000-000000000001',
    'certification_title', 'Wirtschaftsinformatik – Modulprüfungen Bachelor',
    'triggered_by', 'manual_e2e_test'
  ),
  8,
  1,
  'c5000000-0004-4000-8000-000000000001'
);
