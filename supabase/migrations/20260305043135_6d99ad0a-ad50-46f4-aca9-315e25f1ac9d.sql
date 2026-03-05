
-- Recreate all audit helper RPCs (first migration partially failed)

CREATE OR REPLACE FUNCTION public.find_ghost_published_courses()
RETURNS TABLE(course_id uuid, course_title text, course_status text, published_package_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id AS course_id, c.title AS course_title, c.status AS course_status,
    COUNT(cp.id) FILTER (WHERE cp.status = 'published') AS published_package_count
  FROM courses c
  LEFT JOIN course_packages cp ON cp.course_id = c.id
  WHERE c.status = 'published'
  GROUP BY c.id, c.title, c.status
  HAVING COUNT(cp.id) FILTER (WHERE cp.status = 'published') = 0;
$$;

CREATE OR REPLACE FUNCTION public.find_steps_without_jobs()
RETURNS TABLE(step_id uuid, package_id uuid, step_key text, step_status text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ps.id AS step_id, ps.package_id, ps.step_key, ps.status::text AS step_status, ps.updated_at
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE ps.status = 'running'
    AND cp.status = 'building'
    AND ps.updated_at < now() - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = ps.package_id
        AND jq.status IN ('pending', 'queued', 'processing')
    )
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.check_duplicate_active_jobs()
RETURNS TABLE(package_id uuid, job_type text, active_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT package_id, job_type, COUNT(*) AS active_count
  FROM job_queue
  WHERE status IN ('pending', 'queued', 'processing')
    AND package_id IS NOT NULL
  GROUP BY package_id, job_type
  HAVING COUNT(*) > 1
  LIMIT 30;
$$;

CREATE OR REPLACE FUNCTION public.count_placeholder_lessons_in_published()
RETURNS TABLE(count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*) AS count
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  JOIN course_packages cp ON cp.course_id = c.id
  WHERE cp.status = 'published'
    AND (l.content::text ILIKE '%_placeholder%' OR l.content::text ILIKE '%"_placeholder":true%');
$$;

CREATE OR REPLACE FUNCTION public.find_thin_lessons(min_length integer DEFAULT 400, p_limit integer DEFAULT 20)
RETURNS TABLE(lesson_id uuid, lesson_title text, content_length integer, course_title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.id AS lesson_id, l.title AS lesson_title,
    length(l.content::text) AS content_length,
    c.title AS course_title
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  WHERE l.content IS NOT NULL
    AND length(l.content::text) < min_length
    AND length(l.content::text) > 0
  ORDER BY length(l.content::text) ASC
  LIMIT p_limit;
$$;
