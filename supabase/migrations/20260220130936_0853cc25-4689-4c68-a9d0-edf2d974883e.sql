
-- 1) Integrity View: zeigt Placeholder- und Too-Short-Lessons pro Kurs
CREATE OR REPLACE VIEW public.v_course_content_integrity AS
SELECT
  m.course_id,
  count(*) AS total_lessons,
  count(*) FILTER (WHERE (l.content->>'_placeholder')::boolean = true) AS placeholder_lessons,
  count(*) FILTER (
    WHERE l.content IS NULL
       OR l.content->>'html' IS NULL
       OR length(coalesce(l.content->>'html','')) < 200
  ) AS too_short_lessons
FROM lessons l
JOIN modules m ON l.module_id = m.id
GROUP BY m.course_id;

-- 2) Gate-Funktion: ExamPool darf nur starten wenn Content ok
CREATE OR REPLACE FUNCTION public.can_generate_exam_pool(p_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT (placeholder_lessons = 0) AND (too_short_lessons = 0)
     FROM public.v_course_content_integrity
     WHERE course_id = p_course_id),
    false
  );
$$;

-- 3) System-Bypass RPC für Repair-Flow (nur service_role darf das)
CREATE OR REPLACE FUNCTION public.repair_placeholder_lessons(p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fixed int := 0;
  v_still_empty int := 0;
BEGIN
  -- Nur Lessons fixen, die echten Content haben aber Flag vergessen wurde
  SET LOCAL council.publish_bypass = 'true';
  
  UPDATE lessons l
  SET content = jsonb_set(l.content, '{_placeholder}', 'false')
  WHERE l.module_id IN (SELECT id FROM modules WHERE course_id = p_course_id)
    AND (l.content->>'_placeholder')::boolean = true
    AND l.content->>'html' IS NOT NULL
    AND length(coalesce(l.content->>'html','')) >= 200;
  
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  
  -- Zähle Lessons die noch wirklich leer sind (brauchen Content-Generierung)
  SELECT count(*) INTO v_still_empty
  FROM lessons l
  JOIN modules m ON l.module_id = m.id
  WHERE m.course_id = p_course_id
    AND (
      l.content IS NULL
      OR l.content->>'html' IS NULL
      OR length(coalesce(l.content->>'html','')) < 200
      OR (l.content->>'_placeholder')::boolean = true
    );
  
  RETURN jsonb_build_object(
    'fixed_flags', v_fixed,
    'still_empty', v_still_empty,
    'ready', v_still_empty = 0
  );
END;
$$;
