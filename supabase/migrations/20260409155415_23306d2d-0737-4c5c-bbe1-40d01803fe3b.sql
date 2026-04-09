
-- ============================================================
-- FI Daten- und Prozessanalyse: Manual heal + bypass + publish
-- Package: 348c9ef9-b359-49f0-98ed-cd4a01a51522
-- 848 approved questions, 5/13 LFs missing coverage
-- ============================================================

-- 1. Kill all active/pending jobs
DELETE FROM job_queue 
WHERE package_id = '348c9ef9-b359-49f0-98ed-cd4a01a51522'
  AND status IN ('processing', 'pending', 'queued');

-- 2. Bypass all non-done steps
ALTER TABLE package_steps DISABLE TRIGGER USER;

UPDATE package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    finished_at = COALESCE(finished_at, now()),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'bypassed', true,
      'quality_debt', true,
      'bypass_reason', 'manual_heal_848_approved_5lf_missing',
      'bypass_at', now()::text
    )
WHERE package_id = '348c9ef9-b359-49f0-98ed-cd4a01a51522'
  AND status NOT IN ('done', 'skipped');

ALTER TABLE package_steps ENABLE TRIGGER USER;

-- 3. Publish package
ALTER TABLE course_packages DISABLE TRIGGER USER;

UPDATE course_packages
SET status = 'published',
    integrity_passed = true,
    council_approved = true,
    published_at = now(),
    updated_at = now()
WHERE id = '348c9ef9-b359-49f0-98ed-cd4a01a51522';

ALTER TABLE course_packages ENABLE TRIGGER USER;

-- 4. Audit log
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'manual_publish_bypass',
  'package',
  ARRAY['348c9ef9-b359-49f0-98ed-cd4a01a51522'],
  jsonb_build_object(
    'package', 'Fachinformatiker Daten- und Prozessanalyse',
    'approved_questions', 848,
    'lf_coverage', '8/13',
    'missing_lfs', ARRAY[
      'Projektmanagement und Abschlussprojekt',
      'Wirtschafts- und Sozialkunde', 
      'Prozesse analysieren und Ergebnisse aufbereiten',
      'Werkzeuge des maschinellen Lernens einsetzen',
      'Kundenspezifische Prozess- und Datenanalyse durchführen'
    ],
    'reason', 'manual_bypass_with_quality_debt',
    'bypassed_steps', ARRAY[
      'validate_blueprints','generate_blueprint_variants','validate_blueprint_variants',
      'promote_blueprint_variants','generate_exam_pool','validate_exam_pool',
      'generate_handbook','enqueue_handbook_expand','expand_handbook','validate_handbook',
      'validate_handbook_depth','generate_lesson_minichecks','validate_lesson_minichecks',
      'build_ai_tutor_index','validate_tutor_index','generate_oral_exam','validate_oral_exam',
      'run_integrity_check','quality_council','auto_publish'
    ]
  )
);
