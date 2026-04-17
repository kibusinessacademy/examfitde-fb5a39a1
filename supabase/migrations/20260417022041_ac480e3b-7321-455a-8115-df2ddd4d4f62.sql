DO $$
DECLARE
  v_pkg_id uuid;
  v_curr_id uuid;
  v_minicheck_count int := 0;
  v_lesson_count int := 0;
  v_scrum_count int := 0;
BEGIN

  -- HEAL 1: Wirtschaftsfachwirt IHK
  v_pkg_id := '03462382-f62e-4be9-9940-013d42a4435b';
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  SELECT 'package_run_integrity_check', cp.id, 1,
         jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id,
                            'reason', 'manual_bypass_gate_pass_revalidation',
                            'force_council_review', true),
         'pending'
  FROM course_packages cp WHERE cp.id = v_pkg_id
  ON CONFLICT DO NOTHING;

  -- HEAL 2: Kaufmann GAH
  v_pkg_id := '6a2c6859-4b3b-4f6e-b32d-c2574a1333ad';
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  SELECT 'package_validate_exam_pool', cp.id, 1,
         jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id,
                            'reason', 'manual_bypass_clear_stale_telemetry'),
         'pending'
  FROM course_packages cp WHERE cp.id = v_pkg_id
  ON CONFLICT DO NOTHING;

  -- HEAL 3: Bilanzbuchhalter IHK
  v_pkg_id := 'eef4bbe6-6c92-4969-941e-af471e86d67f';
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  SELECT 'pool_fill_bloom_gaps', cp.id, 1,
         jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id,
                            'target_question_count', 280,
                            'target_difficulty_distribution', jsonb_build_object('hardish', 0.40, 'medium', 0.40, 'easy', 0.20),
                            'reason', 'manual_bypass_close_approved_gap'),
         'pending'
  FROM course_packages cp WHERE cp.id = v_pkg_id
  ON CONFLICT DO NOTHING;

  -- HEAL 4: Scrum Master PSM I — per-LF pool fill + unblock
  v_pkg_id := '65430b12-b481-46e0-88f4-c88606857da7';
  SELECT curriculum_id INTO v_curr_id FROM course_packages WHERE id = v_pkg_id;

  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  SELECT 'pool_fill_bloom_gaps', v_pkg_id, 1,
         jsonb_build_object('package_id', v_pkg_id, 'curriculum_id', v_curr_id,
                            'learning_field_filter', lf.code,
                            'learning_field_id', lf.id,
                            'target_question_count', 24,
                            'reason', 'manual_bypass_competency_coverage_gap'),
         'pending'
  FROM learning_fields lf
  WHERE lf.curriculum_id = v_curr_id
    AND EXISTS (
      SELECT 1 FROM competencies c
      WHERE c.learning_field_id = lf.id
        AND NOT EXISTS (
          SELECT 1 FROM exam_questions eq 
          WHERE eq.competency_id = c.id AND eq.status='approved'
        )
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_scrum_count = ROW_COUNT;

  UPDATE course_packages 
  SET status='building', blocked_reason=NULL, last_progress_at=now(), updated_at=now()
  WHERE id = v_pkg_id;

  -- HEAL 5: System-wide MINICHECK_MISSING
  WITH mod_minicheck AS (
    SELECT lf.id AS module_id, lf.curriculum_id,
      EXISTS (
        SELECT 1 FROM lessons l
        JOIN competencies c ON c.id = l.competency_id
        JOIN minicheck_questions mq ON mq.lesson_id = l.id
        WHERE c.learning_field_id = lf.id
      ) AS has_minicheck
    FROM learning_fields lf
  ),
  pkgs_with_gaps AS (
    SELECT cp.id, cp.curriculum_id,
           COUNT(*) FILTER (WHERE NOT mm.has_minicheck) AS gap_count
    FROM course_packages cp
    JOIN mod_minicheck mm ON mm.curriculum_id = cp.curriculum_id
    WHERE cp.status IN ('published','building','done')
      AND cp.archived = false
    GROUP BY cp.id, cp.curriculum_id
    HAVING COUNT(*) FILTER (WHERE NOT mm.has_minicheck) > 0
  )
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  SELECT 'package_generate_lesson_minichecks', pg.id, 2,
         jsonb_build_object('package_id', pg.id, 'curriculum_id', pg.curriculum_id,
                            'only_missing', true,
                            'reason', 'system_heal_minicheck_module_gap',
                            'gap_count', pg.gap_count),
         'pending'
  FROM pkgs_with_gaps pg
  WHERE NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = pg.id 
      AND jq.job_type = 'package_generate_lesson_minichecks'
      AND jq.status IN ('pending','processing','queued')
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_minicheck_count = ROW_COUNT;

  -- HEAL 6: System-wide COMPETENCY_LESSON_GAP — using package_generate_learning_content
  WITH comp_lessons AS (
    SELECT c.id AS competency_id, lf.curriculum_id, COUNT(l.id) AS lesson_count
    FROM competencies c
    JOIN learning_fields lf ON lf.id = c.learning_field_id
    LEFT JOIN lessons l ON l.competency_id = c.id
    GROUP BY c.id, lf.curriculum_id
  ),
  pkg_coverage AS (
    SELECT cp.id, cp.curriculum_id, cp.status,
      ROUND(100.0 * COUNT(*) FILTER (WHERE cl.lesson_count > 0) / NULLIF(COUNT(*),0), 1) AS pct
    FROM course_packages cp
    JOIN comp_lessons cl ON cl.curriculum_id = cp.curriculum_id
    WHERE cp.status IN ('published','building','done','blocked')
      AND cp.archived = false
    GROUP BY cp.id, cp.curriculum_id, cp.status
  )
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  SELECT 
    'package_generate_learning_content', pc.id,
    CASE WHEN pc.status='published' THEN 1 ELSE 2 END,
    jsonb_build_object('package_id', pc.id, 'curriculum_id', pc.curriculum_id,
                       'only_missing', true,
                       'reason', 'system_heal_competency_lesson_gap',
                       'current_coverage_pct', pc.pct),
    'pending'
  FROM pkg_coverage pc
  WHERE pc.pct < 90
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = pc.id 
        AND jq.job_type = 'package_generate_learning_content'
        AND jq.status IN ('pending','processing','queued')
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_lesson_count = ROW_COUNT;

  INSERT INTO admin_actions(action, scope, payload)
  VALUES (
    'system_heal_competency_minicheck_lesson_gaps',
    'system_wide',
    jsonb_build_object(
      'targets_healed', jsonb_build_array(
        '03462382-f62e-4be9-9940-013d42a4435b',
        '6a2c6859-4b3b-4f6e-b32d-c2574a1333ad',
        'eef4bbe6-6c92-4969-941e-af471e86d67f',
        '65430b12-b481-46e0-88f4-c88606857da7'
      ),
      'scrum_lf_jobs', v_scrum_count,
      'system_minicheck_pkgs', v_minicheck_count,
      'system_lesson_pkgs', v_lesson_count,
      'executed_at', now()
    )
  );

  RAISE NOTICE 'Heal complete — Scrum-LF: %, Minicheck pkgs: %, Lesson pkgs: %', 
    v_scrum_count, v_minicheck_count, v_lesson_count;
END $$;