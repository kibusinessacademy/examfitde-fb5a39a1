
CREATE OR REPLACE FUNCTION public.enqueue_learning_content_regen_for_package(
  p_package_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH candidate_lessons AS (
    SELECT l.id AS lesson_id
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    JOIN public.courses c ON c.id = m.course_id
    JOIN public.course_packages cp ON cp.course_id = c.id
    WHERE cp.id = p_package_id
      AND (l.content IS NULL OR l.content::text IN ('null', '""', '') OR length(l.content::text) <= 10 OR l.qc_status = 'tier1_failed')
    ORDER BY l.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
  ),
  ins AS (
    INSERT INTO public.job_queue (
      package_id, job_type, status, payload, created_at, updated_at
    )
    SELECT
      p_package_id, 'lesson_regen_repair', 'pending',
      jsonb_build_object('lesson_id', c.lesson_id, 'reason', 'needs_regen_backfill', 'source', 'enqueue_learning_content_regen_for_package'),
      now(), now()
    FROM candidate_lessons c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = p_package_id AND jq.job_type = 'lesson_regen_repair'
        AND jq.status IN ('pending', 'processing', 'running')
        AND jq.payload->>'lesson_id' = c.lesson_id::text
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$function$;
