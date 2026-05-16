DROP VIEW IF EXISTS public.v_package_sellability_v1 CASCADE;

CREATE OR REPLACE VIEW public.v_package_published_locked_v1 AS
SELECT
  jq.package_id,
  COUNT(*)::int AS cancelled_repair_jobs_7d,
  MAX(jq.completed_at) AS last_cancel_at,
  (ARRAY_AGG(jq.last_error ORDER BY jq.completed_at DESC NULLS LAST))[1] AS last_error
FROM public.job_queue jq
JOIN public.course_packages cp ON cp.id = jq.package_id
WHERE jq.job_type IN (
        'package_scaffold_learning_course',
        'package_repair_failed_lessons',
        'package_generate_learning_content'
      )
  AND jq.status = 'cancelled'
  AND jq.completed_at > now() - interval '7 days'
  AND cp.status = 'published'
GROUP BY jq.package_id;

REVOKE ALL ON public.v_package_published_locked_v1 FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_package_published_locked_v1 TO service_role;

CREATE VIEW public.v_package_sellability_v1 AS
WITH pub AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.package_key,
         cp.curriculum_id, cp.track::text AS track, cp.product_id
  FROM public.course_packages cp
  WHERE cp.status = 'published'
),
content AS (
  SELECT pub.package_id, c.id AS course_id,
    COALESCE((SELECT count(*) FROM public.modules m WHERE m.course_id = c.id),0)::int AS modules,
    COALESCE((SELECT count(*) FROM public.lessons l JOIN public.modules m ON m.id = l.module_id WHERE m.course_id = c.id),0)::int AS lessons,
    COALESCE((SELECT count(*) FROM public.lessons l JOIN public.modules m ON m.id = l.module_id
              WHERE m.course_id = c.id AND (l.generation_status = 'completed' OR l.status = 'ready')),0)::int AS lessons_ready
  FROM pub
  LEFT JOIN public.courses c ON c.curriculum_id = pub.curriculum_id AND c.status = 'published'::course_status
),
questions AS (
  SELECT pub.package_id,
    count(*) FILTER (WHERE eq.status = 'approved'::question_status)::int AS approved_questions
  FROM pub
  LEFT JOIN public.exam_questions eq ON eq.package_id = pub.package_id
  GROUP BY pub.package_id
),
pricing AS (
  SELECT package_id, activation_state FROM public.v_pricing_activation_status
),
locked AS (
  SELECT package_id, cancelled_repair_jobs_7d FROM public.v_package_published_locked_v1
)
SELECT pub.package_id, pub.package_title, pub.package_key, pub.curriculum_id,
       pub.track, pub.product_id, content.course_id,
       content.modules, content.lessons, content.lessons_ready,
       questions.approved_questions,
       pricing.activation_state AS pricing_state,
       CASE WHEN pub.track = 'EXAM_FIRST' THEN false ELSE true END AS requires_lessons,
       COALESCE(locked.cancelled_repair_jobs_7d, 0) AS published_locked_cancels_7d,
       CASE
         WHEN COALESCE(pricing.activation_state,'UNKNOWN') <> 'ACTIVATED' THEN 'pricing_missing'
         WHEN COALESCE(questions.approved_questions,0) < 50 THEN 'questions_missing'
         WHEN pub.track = 'EXAM_FIRST' THEN 'sellable'
         WHEN content.course_id IS NULL OR content.modules = 0 THEN
              CASE WHEN locked.package_id IS NOT NULL THEN 'content_gap_published_locked' ELSE 'modules_missing' END
         WHEN content.lessons = 0 THEN
              CASE WHEN locked.package_id IS NOT NULL THEN 'content_gap_published_locked' ELSE 'lessons_missing' END
         WHEN content.lessons_ready < content.lessons THEN
              CASE WHEN locked.package_id IS NOT NULL THEN 'content_gap_published_locked' ELSE 'lessons_not_ready' END
         ELSE 'sellable'
       END AS gap_class
FROM pub
LEFT JOIN content   ON content.package_id   = pub.package_id
LEFT JOIN questions ON questions.package_id = pub.package_id
LEFT JOIN pricing   ON pricing.package_id   = pub.package_id
LEFT JOIN locked    ON locked.package_id    = pub.package_id;

REVOKE ALL ON public.v_package_sellability_v1 FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_package_sellability_v1 TO service_role;

DROP FUNCTION IF EXISTS public.admin_get_content_sellability_summary();
CREATE OR REPLACE FUNCTION public.admin_get_content_sellability_summary()
RETURNS TABLE(
  track text, total int, sellable int,
  modules_missing int, lessons_missing int, lessons_not_ready int,
  content_gap_published_locked int,
  questions_missing int, pricing_missing int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    v.track,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE v.gap_class = 'sellable')::int,
    COUNT(*) FILTER (WHERE v.gap_class = 'modules_missing')::int,
    COUNT(*) FILTER (WHERE v.gap_class = 'lessons_missing')::int,
    COUNT(*) FILTER (WHERE v.gap_class = 'lessons_not_ready')::int,
    COUNT(*) FILTER (WHERE v.gap_class = 'content_gap_published_locked')::int,
    COUNT(*) FILTER (WHERE v.gap_class = 'questions_missing')::int,
    COUNT(*) FILTER (WHERE v.gap_class = 'pricing_missing')::int
  FROM public.v_package_sellability_v1 v
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY v.track
  ORDER BY COUNT(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_content_sellability_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_content_sellability_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_content_sellability_backfill(p_limit integer DEFAULT 10, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_details jsonb := '[]'::jsonb;
  v_res jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.role()='service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR v_row IN
    SELECT package_id, package_title, gap_class
    FROM public.v_package_sellability_v1
    WHERE gap_class IN ('modules_missing','lessons_missing','lessons_not_ready')
    ORDER BY
      CASE gap_class WHEN 'modules_missing' THEN 1
                     WHEN 'lessons_missing' THEN 2
                     WHEN 'lessons_not_ready' THEN 3 END,
      package_title
    LIMIT GREATEST(1, COALESCE(p_limit, 10))
  LOOP
    v_res := public.admin_content_sellability_dispatch(v_row.package_id, p_dry_run);
    v_details := v_details || jsonb_build_object(
      'package_id', v_row.package_id,
      'package_title', v_row.package_title,
      'gap_class', v_row.gap_class,
      'result', v_res
    );
    IF (v_res->>'dispatched')::boolean THEN v_dispatched := v_dispatched + 1;
    ELSE v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log (
    trigger_source, action_type, target_type, input_params, result_status, result_detail
  ) VALUES (
    'admin_m9', 'm9_content_sellability_backfill', 'system',
    jsonb_build_object('limit', p_limit, 'dry_run', p_dry_run, 'excludes', 'content_gap_published_locked'),
    'success',
    jsonb_build_object('dispatched', v_dispatched, 'skipped', v_skipped)
  );

  RETURN jsonb_build_object(
    'dispatched', v_dispatched, 'skipped', v_skipped,
    'dry_run', p_dry_run, 'details', v_details
  );
END;
$$;

INSERT INTO public.auto_heal_log (
  trigger_source, action_type, target_type, input_params, result_status, result_detail
)
SELECT
  'm9_3a', 'm9_3a_reclassification_cut', 'system',
  jsonb_build_object('window','7d'),
  'success',
  jsonb_build_object(
    'locked_packages', COUNT(*),
    'locked_ids', COALESCE(jsonb_agg(package_id ORDER BY last_cancel_at DESC), '[]'::jsonb)
  )
FROM public.v_package_published_locked_v1;