DO $$
DECLARE v_inserted int;
BEGIN
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
    WHERE cp.status IN ('published','building','done','blocked') AND cp.archived = false
    GROUP BY cp.id, cp.curriculum_id, cp.status
  )
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  SELECT 
    'package_generate_learning_content', pc.id,
    CASE WHEN pc.status='published' THEN 1 ELSE 2 END,
    jsonb_build_object('package_id', pc.id, 'curriculum_id', pc.curriculum_id,
                       'only_missing', true,
                       'reason', 'system_heal_competency_lesson_gap_pass2',
                       'current_coverage_pct', pc.pct,
                       'package_status', pc.status),
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
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO admin_actions(action, scope, payload)
  VALUES ('system_heal_lesson_gap_pass2', 'system_wide',
    jsonb_build_object('inserted_jobs', v_inserted, 'executed_at', now()));

  RAISE NOTICE 'Pass 2 inserted % learning_content jobs', v_inserted;
END $$;