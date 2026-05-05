-- View: published-course readiness (modules + lessons)
CREATE OR REPLACE VIEW public.v_learner_course_readiness AS
SELECT
  c.id,
  c.title,
  COUNT(DISTINCT m.id)::int AS modules,
  COUNT(l.id)::int          AS lessons,
  (COUNT(DISTINCT m.id) > 0 AND COUNT(l.id) > 0) AS is_ready
FROM public.courses c
LEFT JOIN public.modules m ON m.course_id = c.id
LEFT JOIN public.lessons l ON l.module_id = m.id
WHERE c.status = 'published'
GROUP BY c.id, c.title;

REVOKE ALL ON public.v_learner_course_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_learner_course_readiness TO service_role;

-- RPC SSOT: read-only readiness report
CREATE OR REPLACE FUNCTION public.public_learner_course_readiness()
RETURNS TABLE (
  id uuid,
  title text,
  modules int,
  lessons int,
  is_ready boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, modules, lessons, is_ready
  FROM public.v_learner_course_readiness
  ORDER BY is_ready ASC, lessons ASC, title ASC;
$$;

REVOKE ALL ON FUNCTION public.public_learner_course_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_learner_course_readiness() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.public_learner_course_readiness() IS
  'SSOT for Learner Course Readiness Guard. Returns one row per published course with modules/lessons counts and is_ready flag. Read-only; safe for CI.';