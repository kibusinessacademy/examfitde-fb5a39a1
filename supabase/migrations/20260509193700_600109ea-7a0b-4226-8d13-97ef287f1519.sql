DROP VIEW IF EXISTS public.v_courses_publishable CASCADE;
CREATE VIEW public.v_courses_publishable AS
SELECT
  c.id,
  c.curriculum_id,
  c.title,
  c.description,
  c.thumbnail_url,
  c.status,
  c.estimated_duration,
  c.created_by,
  c.published_at,
  c.created_at,
  c.updated_at,
  c.autopilot_status,
  c.autopilot_started_at,
  c.autopilot_sealed_at,
  c.autopilot_runner_id,
  c.quality_score,
  c.quality_report,
  c.publishing_status,
  c.is_ready_for_publish,
  c.compliance_blocked,
  cur.certification_type,
  COALESCE(mc.module_count, 0::bigint) AS module_count,
  COALESCE(lc.lesson_count, 0::bigint) AS lesson_count
FROM courses c
LEFT JOIN curricula cur ON cur.id = c.curriculum_id
LEFT JOIN (
  SELECT modules.course_id, count(*) AS module_count
  FROM modules
  GROUP BY modules.course_id
) mc ON mc.course_id = c.id
LEFT JOIN (
  SELECT m.course_id, count(l.*) AS lesson_count
  FROM modules m
  LEFT JOIN lessons l ON l.module_id = m.id
  GROUP BY m.course_id
) lc ON lc.course_id = c.id
WHERE COALESCE(mc.module_count, 0::bigint) > 0
  AND COALESCE(lc.lesson_count, 0::bigint) > 0;
GRANT SELECT ON public.v_courses_publishable TO anon, authenticated;