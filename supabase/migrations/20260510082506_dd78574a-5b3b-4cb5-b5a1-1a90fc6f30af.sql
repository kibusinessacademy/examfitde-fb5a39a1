
CREATE OR REPLACE FUNCTION public.admin_get_artifact_completeness(
  p_package_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH pkg AS (
    SELECT cp.id AS package_id, cp.title, cp.status, cp.curriculum_id, cp.course_id,
           cp.feature_flags, cp.build_progress
    FROM course_packages cp
    WHERE cp.id = ANY(p_package_ids)
  ),
  les AS (
    SELECT p.package_id,
      COUNT(l.id) AS lessons_total,
      COUNT(l.id) FILTER (
        WHERE l.content IS NOT NULL AND l.content::text <> 'null'
          AND l.content::text NOT LIKE '%_placeholder%'
          AND length(l.content::text) > 500
      ) AS lessons_with_content,
      COUNT(l.id) FILTER (WHERE l.qc_status = 'approved') AS lessons_qc_approved,
      COUNT(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS lessons_with_minicheck
    FROM pkg p
    LEFT JOIN modules m ON m.course_id = p.course_id
    LEFT JOIN lessons l ON l.module_id = m.id
    GROUP BY p.package_id
  ),
  ex AS (
    SELECT p.package_id,
      COUNT(*) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_approved,
      COUNT(*) AS exam_total
    FROM pkg p
    LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
    GROUP BY p.package_id
  ),
  hb AS (
    SELECT p.package_id,
      COUNT(s.id) AS hb_total,
      COUNT(s.id) FILTER (WHERE s.content_markdown IS NOT NULL AND length(s.content_markdown) > 100) AS hb_filled
    FROM pkg p
    LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
    LEFT JOIN handbook_sections s ON s.chapter_id = hc.id
    GROUP BY p.package_id
  ),
  steps AS (
    SELECT ps.package_id,
      COUNT(*) AS steps_total,
      COUNT(*) FILTER (WHERE ps.status = 'done'::step_status) AS steps_done,
      jsonb_agg(jsonb_build_object('step_key', ps.step_key, 'status', ps.status)
                ORDER BY ps.step_key)
        FILTER (WHERE ps.status <> 'done'::step_status) AS open_steps
    FROM package_steps ps
    JOIN pkg p ON p.package_id = ps.package_id
    GROUP BY ps.package_id
  ),
  computed AS (
    SELECT p.package_id, p.title, p.status, p.build_progress,
      COALESCE(les.lessons_total,0) AS lessons_total,
      COALESCE(les.lessons_with_content,0) AS lessons_with_content,
      COALESCE(les.lessons_qc_approved,0) AS lessons_qc_approved,
      COALESCE(les.lessons_with_minicheck,0) AS lessons_with_minicheck,
      COALESCE(ex.exam_approved,0) AS exam_approved,
      COALESCE(ex.exam_total,0) AS exam_total,
      COALESCE(hb.hb_total,0) AS hb_total,
      COALESCE(hb.hb_filled,0) AS hb_filled,
      COALESCE(steps.steps_total,0) AS steps_total,
      COALESCE(steps.steps_done,0) AS steps_done,
      COALESCE(steps.open_steps,'[]'::jsonb) AS open_steps
    FROM pkg p
    LEFT JOIN les ON les.package_id = p.package_id
    LEFT JOIN ex ON ex.package_id = p.package_id
    LEFT JOIN hb ON hb.package_id = p.package_id
    LEFT JOIN steps ON steps.package_id = p.package_id
  ),
  gap_calc AS (
    SELECT c.*,
      GREATEST(c.lessons_total - c.lessons_with_content, 0) AS gap_content,
      GREATEST(c.lessons_with_content - c.lessons_qc_approved, 0) AS gap_qc,
      GREATEST(c.lessons_with_content - c.lessons_with_minicheck, 0) AS gap_mc,
      GREATEST(500 - c.exam_approved, 0) AS gap_exam,
      GREATEST(c.hb_total - c.hb_filled, 0) AS gap_hb,
      jsonb_array_length(c.open_steps) AS gap_steps
    FROM computed c
  ),
  prioritized AS (
    SELECT g.*,
      (SELECT jsonb_agg(item ORDER BY priority) FROM (
        SELECT 1 AS priority, jsonb_build_object(
          'priority', 1, 'gap', 'lessons_missing_content', 'count', g.gap_content,
          'severity', CASE WHEN g.gap_content > 10 THEN 'critical' WHEN g.gap_content > 0 THEN 'warn' ELSE 'ok' END,
          'recommended_action', 'admin_nudge_atomic_trigger',
          'recommended_step', 'generate_lesson_content',
          'reason', 'Content fehlt — Voraussetzung für QC + MiniCheck'
        ) AS item WHERE g.gap_content > 0
        UNION ALL
        SELECT 2, jsonb_build_object(
          'priority', 2, 'gap', 'lessons_missing_qc', 'count', g.gap_qc,
          'severity', CASE WHEN g.gap_qc > 10 THEN 'critical' WHEN g.gap_qc > 0 THEN 'warn' ELSE 'ok' END,
          'recommended_action', 'admin_nudge_atomic_trigger',
          'recommended_step', 'qc_lesson_content',
          'reason', 'QC ausstehend — blockiert Council'
        ) WHERE g.gap_qc > 0
        UNION ALL
        SELECT 3, jsonb_build_object(
          'priority', 3, 'gap', 'lessons_missing_minicheck', 'count', g.gap_mc,
          'severity', CASE WHEN g.gap_mc > 10 THEN 'warn' ELSE 'info' END,
          'recommended_action', 'admin_enqueue_minicheck_repair_targeted',
          'recommended_step', 'generate_lesson_minichecks',
          'reason', 'MiniChecks fehlen — Lernpfad unvollständig'
        ) WHERE g.gap_mc > 0
        UNION ALL
        SELECT 4, jsonb_build_object(
          'priority', 4, 'gap', 'exam_below_target', 'count', g.gap_exam,
          'severity', CASE WHEN g.exam_approved < 100 THEN 'critical'
                           WHEN g.exam_approved < 300 THEN 'warn' ELSE 'info' END,
          'recommended_action', 'admin_nudge_atomic_trigger',
          'recommended_step', 'generate_exam_pool',
          'reason', 'Exam-Pool unter Ziel (500 approved)'
        ) WHERE g.gap_exam > 0
        UNION ALL
        SELECT 5, jsonb_build_object(
          'priority', 5, 'gap', 'handbook_empty_sections', 'count', g.gap_hb,
          'severity', CASE WHEN g.gap_hb > 5 THEN 'warn' ELSE 'info' END,
          'recommended_action', 'admin_nudge_atomic_trigger',
          'recommended_step', 'generate_handbook',
          'reason', 'Handbook-Sektionen leer'
        ) WHERE g.gap_hb > 0
        UNION ALL
        SELECT 6, jsonb_build_object(
          'priority', 6, 'gap', 'open_steps', 'count', g.gap_steps,
          'severity', 'info',
          'recommended_action', 'admin_retry_failed_step',
          'recommended_step', NULL,
          'reason', 'Pipeline-Steps noch offen'
        ) WHERE g.gap_steps > 0
      ) sub) AS prioritized_gaps
    FROM gap_calc g
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'packages', COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', p.package_id,
      'title', p.title,
      'status', p.status,
      'build_progress', p.build_progress,
      'lessons', jsonb_build_object(
        'total', p.lessons_total,
        'with_content', p.lessons_with_content,
        'qc_approved', p.lessons_qc_approved,
        'with_minicheck', p.lessons_with_minicheck,
        'missing_content', p.gap_content,
        'missing_qc', p.gap_qc,
        'missing_minicheck', p.gap_mc
      ),
      'exam', jsonb_build_object(
        'approved', p.exam_approved, 'total', p.exam_total,
        'target', 500, 'missing', p.gap_exam
      ),
      'handbook', jsonb_build_object(
        'sections_total', p.hb_total, 'sections_filled', p.hb_filled, 'missing', p.gap_hb
      ),
      'steps', jsonb_build_object(
        'total', p.steps_total, 'done', p.steps_done, 'open', p.open_steps
      ),
      'prioritized_gaps', COALESCE(p.prioritized_gaps, '[]'::jsonb),
      'next_action', CASE
        WHEN p.prioritized_gaps IS NULL THEN
          jsonb_build_object('action', 'none', 'reason', 'Paket vollständig')
        ELSE p.prioritized_gaps->0
      END
    )), '[]'::jsonb)
  ) INTO v
  FROM prioritized p;

  RETURN COALESCE(v, jsonb_build_object('packages', '[]'::jsonb, 'generated_at', now()));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_artifact_completeness(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_artifact_completeness(uuid[]) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_get_heal_run_timeline(
  p_package_id uuid,
  p_window_hours integer DEFAULT 72,
  p_limit integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH heal AS (
    SELECT
      ahl.created_at AS at,
      'heal_log'::text AS kind,
      ahl.action_type AS event,
      ahl.result_status AS status,
      jsonb_build_object(
        'id', ahl.id,
        'trigger_source', ahl.trigger_source,
        'reason', COALESCE(ahl.metadata->>'reason', ahl.input_params->>'reason', ahl.metadata->>'note'),
        'detail', ahl.result_detail,
        'error', ahl.error_message,
        'duration_ms', ahl.duration_ms,
        'metadata', ahl.metadata,
        'input_params', ahl.input_params
      ) AS payload
    FROM auto_heal_log ahl
    WHERE (ahl.target_id = p_package_id::text
        OR ahl.metadata->>'package_id' = p_package_id::text
        OR ahl.input_params->>'package_id' = p_package_id::text)
      AND ahl.created_at >= now() - make_interval(hours => p_window_hours)
  ),
  jobs_created AS (
    SELECT
      jq.created_at AS at,
      'job_enqueued'::text AS kind,
      jq.job_type AS event,
      'pending'::text AS status,
      jsonb_build_object(
        'job_id', jq.id,
        'job_type', jq.job_type,
        'lane', jq.lane,
        'worker_pool', jq.worker_pool,
        'enqueue_source', jq.payload->>'enqueue_source',
        'origin', jq.payload->>'_origin',
        'bronze_lock_override', COALESCE((jq.payload->>'bronze_lock_override')::boolean, false),
        'priority', jq.priority
      ) AS payload
    FROM job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.created_at >= now() - make_interval(hours => p_window_hours)
  ),
  jobs_done AS (
    SELECT
      jq.completed_at AS at,
      'job_finished'::text AS kind,
      jq.job_type AS event,
      jq.status AS status,
      jsonb_build_object(
        'job_id', jq.id,
        'job_type', jq.job_type,
        'duration_sec', EXTRACT(EPOCH FROM (jq.completed_at - jq.started_at))::int,
        'last_error', jq.last_error,
        'attempts', jq.attempts,
        'lane', jq.lane,
        'bronze_lock_override', COALESCE((jq.payload->>'bronze_lock_override')::boolean, false)
      ) AS payload
    FROM job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.completed_at IS NOT NULL
      AND jq.completed_at >= now() - make_interval(hours => p_window_hours)
  ),
  combined AS (
    SELECT * FROM heal
    UNION ALL SELECT * FROM jobs_created
    UNION ALL SELECT * FROM jobs_done
  ),
  ordered AS (
    SELECT * FROM combined
    ORDER BY at DESC
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'package_id', p_package_id,
    'window_hours', p_window_hours,
    'pkg_status', (SELECT status FROM course_packages WHERE id = p_package_id),
    'pkg_progress', (SELECT build_progress FROM course_packages WHERE id = p_package_id),
    'summary', jsonb_build_object(
      'log_entries', (SELECT COUNT(*) FROM heal),
      'jobs_enqueued', (SELECT COUNT(*) FROM jobs_created),
      'jobs_finished', (SELECT COUNT(*) FROM jobs_done),
      'jobs_completed', (SELECT COUNT(*) FROM jobs_done WHERE status='completed'),
      'jobs_failed', (SELECT COUNT(*) FROM jobs_done WHERE status='failed'),
      'jobs_cancelled', (SELECT COUNT(*) FROM jobs_done WHERE status='cancelled'),
      'bronze_overrides', (
        SELECT COUNT(*) FROM job_queue jq2
        WHERE jq2.package_id = p_package_id
          AND jq2.created_at >= now() - make_interval(hours => p_window_hours)
          AND COALESCE((jq2.payload->>'bronze_lock_override')::boolean, false) = true
      )
    ),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'at', at, 'kind', kind, 'event', event, 'status', status, 'payload', payload
      ) ORDER BY at DESC) FROM ordered
    ), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_heal_run_timeline(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_run_timeline(uuid, integer, integer) TO authenticated;
