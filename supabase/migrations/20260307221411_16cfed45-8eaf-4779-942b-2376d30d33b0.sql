
-- RPC: Count lessons without competency_id per package (legacy audit)
CREATE OR REPLACE FUNCTION public.get_legacy_lesson_audit(p_package_id uuid DEFAULT NULL)
RETURNS TABLE(
  package_id uuid,
  package_title text,
  total_lessons bigint,
  lessons_with_competency bigint,
  lessons_without_competency bigint,
  legacy_pct numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id AS package_id,
    cp.title AS package_title,
    COUNT(l.id) AS total_lessons,
    COUNT(l.competency_id) AS lessons_with_competency,
    COUNT(l.id) - COUNT(l.competency_id) AS lessons_without_competency,
    CASE WHEN COUNT(l.id) > 0
      THEN ROUND((COUNT(l.id) - COUNT(l.competency_id))::numeric / COUNT(l.id) * 100, 1)
      ELSE 0
    END AS legacy_pct
  FROM course_packages cp
  JOIN courses c ON c.id = cp.course_id
  JOIN modules m ON m.course_id = c.id
  JOIN lessons l ON l.module_id = m.id
  WHERE (p_package_id IS NULL OR cp.id = p_package_id)
    AND cp.status NOT IN ('archived')
  GROUP BY cp.id, cp.title
  HAVING COUNT(l.id) - COUNT(l.competency_id) > 0
  ORDER BY lessons_without_competency DESC;
$$;

-- RPC: Get competency bundle progress for a package  
CREATE OR REPLACE FUNCTION public.get_competency_bundle_progress(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_competencies', (
      SELECT COUNT(DISTINCT l.competency_id)
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      JOIN courses c ON c.id = m.course_id
      JOIN course_packages cp ON cp.course_id = c.id
      WHERE cp.id = p_package_id AND l.competency_id IS NOT NULL
    ),
    'bundles_total', (
      SELECT COUNT(*) FROM job_queue
      WHERE package_id = p_package_id
        AND job_type = 'lesson_generate_competency_bundle'
    ),
    'bundles_done', (
      SELECT COUNT(*) FROM job_queue
      WHERE package_id = p_package_id
        AND job_type = 'lesson_generate_competency_bundle'
        AND status = 'done'
    ),
    'bundles_failed', (
      SELECT COUNT(*) FROM job_queue
      WHERE package_id = p_package_id
        AND job_type = 'lesson_generate_competency_bundle'
        AND status = 'failed'
    ),
    'bundles_active', (
      SELECT COUNT(*) FROM job_queue
      WHERE package_id = p_package_id
        AND job_type = 'lesson_generate_competency_bundle'
        AND status IN ('pending', 'processing', 'queued')
    ),
    'legacy_lessons', (
      SELECT COUNT(*) FROM job_queue
      WHERE package_id = p_package_id
        AND job_type = 'lesson_generate_content'
        AND status IN ('pending', 'processing', 'queued')
    ),
    'lesson_subjobs_total', (
      SELECT COUNT(*) FROM job_queue
      WHERE package_id = p_package_id
        AND job_type = 'lesson_generate_content'
    ),
    'lesson_subjobs_done', (
      SELECT COUNT(*) FROM job_queue
      WHERE package_id = p_package_id
        AND job_type = 'lesson_generate_content'
        AND status = 'done'
    )
  );
$$;
