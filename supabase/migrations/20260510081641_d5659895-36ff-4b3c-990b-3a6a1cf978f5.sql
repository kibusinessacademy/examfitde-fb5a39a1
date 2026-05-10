
-- ============================================================
-- ARTIFACT COMPLETENESS + WORKER OUTPUT + HEAL LOG VIEWER (v1)
-- ============================================================

-- 1) admin_get_artifact_completeness(p_package_ids uuid[])
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
        WHERE l.content IS NOT NULL
          AND l.content::text <> 'null'
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
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'packages', COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', p.package_id,
      'title', p.title,
      'status', p.status,
      'build_progress', p.build_progress,
      'lessons', jsonb_build_object(
        'total', COALESCE(les.lessons_total, 0),
        'with_content', COALESCE(les.lessons_with_content, 0),
        'qc_approved', COALESCE(les.lessons_qc_approved, 0),
        'with_minicheck', COALESCE(les.lessons_with_minicheck, 0),
        'missing_content', GREATEST(COALESCE(les.lessons_total,0) - COALESCE(les.lessons_with_content,0), 0),
        'missing_qc', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_qc_approved,0), 0),
        'missing_minicheck', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_with_minicheck,0), 0)
      ),
      'exam', jsonb_build_object(
        'approved', COALESCE(ex.exam_approved, 0),
        'total', COALESCE(ex.exam_total, 0),
        'target', 500,
        'missing', GREATEST(500 - COALESCE(ex.exam_approved,0), 0)
      ),
      'handbook', jsonb_build_object(
        'sections_total', COALESCE(hb.hb_total, 0),
        'sections_filled', COALESCE(hb.hb_filled, 0),
        'missing', GREATEST(COALESCE(hb.hb_total,0) - COALESCE(hb.hb_filled,0), 0)
      ),
      'steps', jsonb_build_object(
        'total', COALESCE(steps.steps_total, 0),
        'done', COALESCE(steps.steps_done, 0),
        'open', COALESCE(steps.open_steps, '[]'::jsonb)
      ),
      'gaps', (
        SELECT COALESCE(jsonb_agg(g), '[]'::jsonb) FROM (
          SELECT 'lessons_missing_content' AS gap, GREATEST(COALESCE(les.lessons_total,0) - COALESCE(les.lessons_with_content,0), 0) AS count
          WHERE GREATEST(COALESCE(les.lessons_total,0) - COALESCE(les.lessons_with_content,0), 0) > 0
          UNION ALL
          SELECT 'lessons_missing_qc', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_qc_approved,0), 0)
          WHERE GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_qc_approved,0), 0) > 0
          UNION ALL
          SELECT 'lessons_missing_minicheck', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_with_minicheck,0), 0)
          WHERE GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_with_minicheck,0), 0) > 0
          UNION ALL
          SELECT 'exam_below_target', GREATEST(500 - COALESCE(ex.exam_approved,0), 0)
          WHERE GREATEST(500 - COALESCE(ex.exam_approved,0), 0) > 0
          UNION ALL
          SELECT 'handbook_empty_sections', GREATEST(COALESCE(hb.hb_total,0) - COALESCE(hb.hb_filled,0), 0)
          WHERE GREATEST(COALESCE(hb.hb_total,0) - COALESCE(hb.hb_filled,0), 0) > 0
          UNION ALL
          SELECT 'open_steps', COALESCE(jsonb_array_length(steps.open_steps), 0)
          WHERE COALESCE(jsonb_array_length(steps.open_steps), 0) > 0
        ) g
      )
    )), '[]'::jsonb)
  )
  INTO v
  FROM pkg p
  LEFT JOIN les ON les.package_id = p.package_id
  LEFT JOIN ex ON ex.package_id = p.package_id
  LEFT JOIN hb ON hb.package_id = p.package_id
  LEFT JOIN steps ON steps.package_id = p.package_id;

  RETURN COALESCE(v, jsonb_build_object('packages', '[]'::jsonb, 'generated_at', now()));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_artifact_completeness(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_artifact_completeness(uuid[]) TO authenticated;

-- 2) admin_get_worker_output_breakdown
CREATE OR REPLACE FUNCTION public.admin_get_worker_output_breakdown(
  p_window_hours integer DEFAULT 24
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

  WITH base AS (
    SELECT
      jq.id, jq.job_type, jq.status, jq.last_error, jq.payload, jq.meta,
      jq.completed_at, jq.created_at
    FROM job_queue jq
    WHERE COALESCE(jq.completed_at, jq.updated_at, jq.created_at)
          >= now() - make_interval(hours => p_window_hours)
      AND jq.status IN ('completed','cancelled','failed')
  ),
  classified AS (
    SELECT b.*,
      CASE b.status
        WHEN 'completed' THEN 'success'
        WHEN 'cancelled' THEN COALESCE(
          NULLIF(b.payload->>'_cancel_reason', ''),
          NULLIF(b.meta->>'cancel_reason', ''),
          NULLIF(b.meta->>'cancelled_reason', ''),
          'unspecified_cancel'
        )
        WHEN 'failed' THEN
          CASE
            WHEN b.last_error ILIKE '%timeout%' OR b.last_error ILIKE '%timed out%' THEN 'timeout'
            WHEN b.last_error ILIKE '%rate%limit%' OR b.last_error ILIKE '%429%' THEN 'rate_limit'
            WHEN b.last_error ILIKE '%5__%' OR b.last_error ILIKE '%upstream%' OR b.last_error ILIKE '%502%' OR b.last_error ILIKE '%503%' OR b.last_error ILIKE '%504%' THEN 'upstream_5xx'
            WHEN b.last_error ILIKE '%validation%' OR b.last_error ILIKE '%schema%' OR b.last_error ILIKE '%invalid%' THEN 'validation'
            WHEN b.last_error ILIKE '%cpu%' OR b.last_error ILIKE '%resource%' OR b.last_error ILIKE '%memory%' THEN 'resource_kill'
            WHEN b.last_error ILIKE '%duplicate%' OR b.last_error ILIKE '%already exists%' THEN 'duplicate'
            WHEN b.last_error IS NULL OR b.last_error = '' THEN 'unknown_failure'
            ELSE 'other_failure'
          END
        ELSE 'other'
      END AS cause_category
    FROM base b
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'window_hours', p_window_hours,
    'totals', jsonb_build_object(
      'completed', COUNT(*) FILTER (WHERE status = 'completed'),
      'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
      'failed', COUNT(*) FILTER (WHERE status = 'failed'),
      'total', COUNT(*)
    ),
    'by_status_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'status', status, 'cause_category', cause_category, 'count', cnt
      ) ORDER BY cnt DESC)
      FROM (
        SELECT status, cause_category, COUNT(*) AS cnt
        FROM classified
        GROUP BY status, cause_category
      ) s
    ), '[]'::jsonb),
    'by_job_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'job_type', job_type,
        'completed', cmp,
        'cancelled', cnc,
        'failed', fld,
        'top_cause', top_cause
      ) ORDER BY (cmp+cnc+fld) DESC)
      FROM (
        SELECT job_type,
          COUNT(*) FILTER (WHERE status='completed') AS cmp,
          COUNT(*) FILTER (WHERE status='cancelled') AS cnc,
          COUNT(*) FILTER (WHERE status='failed') AS fld,
          (SELECT cause_category FROM classified c2
           WHERE c2.job_type = c1.job_type AND c2.status <> 'completed'
           GROUP BY cause_category ORDER BY COUNT(*) DESC LIMIT 1) AS top_cause
        FROM classified c1
        GROUP BY job_type
      ) j
    ), '[]'::jsonb)
  )
  INTO v
  FROM classified;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_worker_output_breakdown(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_worker_output_breakdown(integer) TO authenticated;

-- 3) admin_get_package_heal_log
CREATE OR REPLACE FUNCTION public.admin_get_package_heal_log(
  p_package_id uuid,
  p_limit integer DEFAULT 100
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

  WITH logs AS (
    SELECT id, created_at, action_type, trigger_source, target_type,
           result_status, result_detail, error_message, duration_ms,
           input_params, metadata
    FROM auto_heal_log
    WHERE target_id = p_package_id::text
       OR (metadata->>'package_id') = p_package_id::text
       OR (input_params->>'package_id') = p_package_id::text
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  jobs AS (
    SELECT id, job_type, status, created_at, completed_at,
           COALESCE((payload->>'bronze_lock_override')::boolean, false) AS bronze_lock_override,
           payload->>'_origin' AS origin,
           payload->>'enqueue_source' AS enqueue_source,
           last_error,
           payload
    FROM job_queue
    WHERE package_id = p_package_id
      AND created_at >= now() - interval '7 days'
    ORDER BY created_at DESC
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'package_id', p_package_id,
    'log_entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'created_at', created_at,
        'action_type', action_type, 'trigger_source', trigger_source,
        'target_type', target_type, 'result_status', result_status,
        'result_detail', result_detail, 'error_message', error_message,
        'duration_ms', duration_ms,
        'reason', COALESCE(metadata->>'reason', input_params->>'reason', metadata->>'note'),
        'input_params', input_params, 'metadata', metadata
      ) ORDER BY created_at DESC) FROM logs
    ), '[]'::jsonb),
    'enqueued_jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'job_type', job_type, 'status', status,
        'created_at', created_at, 'completed_at', completed_at,
        'bronze_lock_override', bronze_lock_override,
        'origin', origin, 'enqueue_source', enqueue_source,
        'last_error', last_error
      ) ORDER BY created_at DESC) FROM jobs
    ), '[]'::jsonb)
  )
  INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_package_heal_log(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_package_heal_log(uuid, integer) TO authenticated;
