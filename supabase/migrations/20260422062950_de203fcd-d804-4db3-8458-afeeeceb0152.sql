
WITH pkg AS (
  SELECT id, curriculum_id FROM course_packages WHERE id='180c24a9-eba7-4159-ada8-140cee76f947'
)
, s1 AS (
  UPDATE package_steps
  SET status='queued', started_at=NULL, finished_at=NULL, last_error=NULL,
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'reset_by','manual_heal_v1','reset_at', now(),
        'reset_reason','min_question_count_below_850_requeue_after_variant_fanout')
  WHERE package_id=(SELECT id FROM pkg) AND step_key='quality_council'
  RETURNING 1
)
, s2 AS (
  UPDATE package_steps
  SET status='queued', started_at=NULL, finished_at=NULL, last_error=NULL,
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by','admin_manual',
        'requeued_by','manual_heal_v1',
        'requeued_at', now(),
        'requeue_reason','expand_pool_to_meet_min_850')
  WHERE package_id=(SELECT id FROM pkg)
    AND step_key IN ('generate_blueprint_variants','validate_blueprint_variants',
                     'promote_blueprint_variants','repair_exam_pool_quality')
  RETURNING 1
)
, s3 AS (
  INSERT INTO job_queue (job_type, package_id, status, priority, payload, max_attempts, lane, meta)
  SELECT 'package_generate_blueprint_variants',
         (SELECT id FROM pkg),
         'pending', 70,
         jsonb_build_object(
           'package_id', (SELECT id FROM pkg),
           'curriculum_id', (SELECT curriculum_id FROM pkg),
           'step_key','generate_blueprint_variants'),
         5, 'build',
         jsonb_build_object('source','manual_heal_v1','reason','min_question_count_expand')
  WHERE NOT EXISTS (
    SELECT 1 FROM job_queue
    WHERE package_id=(SELECT id FROM pkg)
      AND job_type='package_generate_blueprint_variants'
      AND status IN ('pending','processing')
  )
  RETURNING 1
)
INSERT INTO admin_notifications (severity, category, title, body, entity_type, entity_id, metadata)
SELECT 'info','heal',
  'Manual Heal: IT-System-Elektroniker/-in',
  'quality_council reset + generate_blueprint_variants requeued. Pool 598 → Ziel ≥850 (Elite).',
  'package', (SELECT id FROM pkg),
  jsonb_build_object('strategy','expand_pool_via_variants','active_bp',120,
                     'questions_current',598,'questions_target',850,
                     'failing_rule','min_question_count');
