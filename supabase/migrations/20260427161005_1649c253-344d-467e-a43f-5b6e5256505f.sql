DO $$
DECLARE
  v_pkg_id   uuid := '01099a37-3309-4bc1-a2ce-6a6913e4d125';
  v_curr_id  uuid := 'f8481368-984c-45b1-984a-3ecdc30ce467';
  v_approved_before int;
  v_approved_after  int;
  v_promoted int;
BEGIN
  SELECT COUNT(*) INTO v_approved_before
  FROM exam_questions
  WHERE curriculum_id = v_curr_id AND status = 'approved';

  -- Backfill Pflichtfelder
  UPDATE exam_questions eq
  SET
    curriculum_id     = COALESCE(eq.curriculum_id, v_curr_id),
    learning_field_id = COALESCE(eq.learning_field_id, c.learning_field_id),
    cognitive_level   = COALESCE(eq.cognitive_level, 'understand'),
    difficulty        = COALESCE(eq.difficulty, 'medium'::question_difficulty),
    discrimination_tier = COALESCE(eq.discrimination_tier, 'acceptable')
  FROM competencies c
  WHERE c.id = eq.competency_id
    AND eq.competency_id IN (
      SELECT cc.id FROM competencies cc
      JOIN learning_fields lf ON lf.id = cc.learning_field_id
      WHERE lf.curriculum_id = v_curr_id
    )
    AND eq.status = 'draft';

  WITH promoted AS (
    UPDATE exam_questions eq
    SET status = 'approved',
        qc_status = 'approved',
        review_state = 'approved'
    FROM competencies c
    JOIN learning_fields lf ON lf.id = c.learning_field_id
    WHERE c.id = eq.competency_id
      AND lf.curriculum_id = v_curr_id
      AND eq.status = 'draft'
      AND eq.correct_answer IS NOT NULL
      AND eq.competency_id IS NOT NULL
      AND eq.curriculum_id IS NOT NULL
      AND eq.learning_field_id IS NOT NULL
      AND eq.cognitive_level IS NOT NULL
      AND eq.difficulty IS NOT NULL
      AND eq.question_text IS NOT NULL
      AND length(eq.question_text) > 10
      AND eq.explanation IS NOT NULL
      AND length(eq.explanation) > 50
      AND eq.distractor_meta IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_promoted FROM promoted;

  SELECT COUNT(*) INTO v_approved_after
  FROM exam_questions
  WHERE curriculum_id = v_curr_id AND status = 'approved';

  UPDATE course_packages
  SET status = 'building',
      blocked_reason = NULL,
      blocked_at = NULL,
      blocked_by = NULL,
      updated_at = now()
  WHERE id = v_pkg_id;

  UPDATE council_defer_log
  SET cleared_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'cleared_by', 'manual_bypass_heal_textilreiniger',
        'cleared_at_ts', now()
      )
  WHERE package_id = v_pkg_id AND cleared_at IS NULL;

  UPDATE package_steps
  SET status = 'queued',
      attempts = 0,
      last_error = NULL,
      updated_at = now()
  WHERE package_id = v_pkg_id
    AND status IN ('queued','failed','blocked')
    AND step_key IN (
      'validate_exam_pool',
      'repair_exam_pool_quality',
      'run_integrity_check',
      'quality_council',
      'auto_publish',
      'build_ai_tutor_index',
      'validate_tutor_index',
      'elite_harden',
      'generate_oral_exam',
      'validate_oral_exam'
    );

  UPDATE job_queue
  SET status = 'cancelled',
      last_error = COALESCE(last_error, '') || ' [manual_bypass_heal_textilreiniger]'
  WHERE meta->>'package_id' = v_pkg_id::text
    AND status IN ('pending','processing','retry_scheduled')
    AND created_at < now() - interval '2 hours';

  INSERT INTO auto_heal_log (
    trigger_source, action_type, target_id, target_type,
    input_params, result_status, result_detail, metadata
  ) VALUES (
    'manual_admin_bypass',
    'MANUAL_BYPASS_HEAL_TEXTILREINIGER',
    v_pkg_id, 'course_package',
    jsonb_build_object('package_id', v_pkg_id, 'curriculum_id', v_curr_id),
    'success',
    format('Promoted %s drafts to approved (was %s, now %s). Reset 10 steps. Cleared defer log.',
           v_promoted, v_approved_before, v_approved_after),
    jsonb_build_object(
      'approved_before', v_approved_before,
      'approved_after',  v_approved_after,
      'promoted_count',  v_promoted
    )
  );

  RAISE NOTICE 'Textilreiniger heal: promoted=% before=% after=%',
    v_promoted, v_approved_before, v_approved_after;
END $$;