-- ============================================================
-- Track M9: Content Sellability Gap Closure
-- ============================================================

-- 1) SSOT view: track-aware content sellability per published package
CREATE OR REPLACE VIEW public.v_package_sellability_v1 AS
WITH pub AS (
  SELECT
    cp.id AS package_id,
    cp.title AS package_title,
    cp.package_key,
    cp.curriculum_id,
    cp.track::text AS track,
    cp.product_id
  FROM public.course_packages cp
  WHERE cp.status = 'published'
),
content AS (
  SELECT
    pub.package_id,
    c.id AS course_id,
    COALESCE((SELECT COUNT(*) FROM public.modules m WHERE m.course_id = c.id), 0)::int AS modules,
    COALESCE((SELECT COUNT(*) FROM public.lessons l
              JOIN public.modules m ON m.id = l.module_id
              WHERE m.course_id = c.id), 0)::int AS lessons,
    COALESCE((SELECT COUNT(*) FROM public.lessons l
              JOIN public.modules m ON m.id = l.module_id
              WHERE m.course_id = c.id
                AND (l.generation_status = 'completed' OR l.status = 'ready')), 0)::int AS lessons_ready
  FROM pub
  LEFT JOIN public.courses c
    ON c.curriculum_id = pub.curriculum_id AND c.status = 'published'
),
questions AS (
  SELECT pub.package_id,
         COUNT(*) FILTER (WHERE eq.status = 'approved')::int AS approved_questions
  FROM pub
  LEFT JOIN public.exam_questions eq ON eq.package_id = pub.package_id
  GROUP BY pub.package_id
),
pricing AS (
  SELECT package_id, activation_state
  FROM public.v_pricing_activation_status
)
SELECT
  pub.package_id,
  pub.package_title,
  pub.package_key,
  pub.curriculum_id,
  pub.track,
  pub.product_id,
  content.course_id,
  content.modules,
  content.lessons,
  content.lessons_ready,
  questions.approved_questions,
  pricing.activation_state AS pricing_state,
  -- Track-aware requirement flags
  CASE WHEN pub.track = 'EXAM_FIRST' THEN false ELSE true END AS requires_lessons,
  -- Gap classification (first-match wins, ordered by repair priority)
  CASE
    WHEN COALESCE(pricing.activation_state, 'UNKNOWN') <> 'ACTIVATED' THEN 'pricing_missing'
    WHEN COALESCE(questions.approved_questions, 0) < 50 THEN 'questions_missing'
    WHEN pub.track = 'EXAM_FIRST' THEN 'sellable'
    WHEN content.course_id IS NULL OR content.modules = 0 THEN 'modules_missing'
    WHEN content.lessons = 0 THEN 'lessons_missing'
    WHEN content.lessons_ready < content.lessons THEN 'lessons_not_ready'
    ELSE 'sellable'
  END AS gap_class
FROM pub
LEFT JOIN content   ON content.package_id   = pub.package_id
LEFT JOIN questions ON questions.package_id = pub.package_id
LEFT JOIN pricing   ON pricing.package_id   = pub.package_id;

REVOKE ALL ON public.v_package_sellability_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_sellability_v1 TO service_role;

COMMENT ON VIEW public.v_package_sellability_v1 IS
  'Track M9 SSOT: track-aware content sellability per published package. Service-role only; access via admin RPCs.';

-- 2) RPC: per-track summary
CREATE OR REPLACE FUNCTION public.admin_get_content_sellability_summary()
RETURNS TABLE(
  track text,
  total int,
  sellable int,
  modules_missing int,
  lessons_missing int,
  lessons_not_ready int,
  questions_missing int,
  pricing_missing int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    track,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE gap_class = 'sellable')::int,
    COUNT(*) FILTER (WHERE gap_class = 'modules_missing')::int,
    COUNT(*) FILTER (WHERE gap_class = 'lessons_missing')::int,
    COUNT(*) FILTER (WHERE gap_class = 'lessons_not_ready')::int,
    COUNT(*) FILTER (WHERE gap_class = 'questions_missing')::int,
    COUNT(*) FILTER (WHERE gap_class = 'pricing_missing')::int
  FROM public.v_package_sellability_v1
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY track
  ORDER BY total DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_content_sellability_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_content_sellability_summary() TO authenticated, service_role;

-- 3) RPC: per-package gap detail
CREATE OR REPLACE FUNCTION public.admin_get_content_sellability_gaps(p_gap_class text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE(
  package_id uuid,
  package_title text,
  track text,
  gap_class text,
  modules int,
  lessons int,
  lessons_ready int,
  approved_questions int,
  pricing_state text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.package_id, s.package_title, s.track, s.gap_class,
    s.modules, s.lessons, s.lessons_ready, s.approved_questions, s.pricing_state
  FROM public.v_package_sellability_v1 s
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (p_gap_class IS NULL OR s.gap_class = p_gap_class)
    AND s.gap_class <> 'sellable'
  ORDER BY
    CASE s.gap_class
      WHEN 'modules_missing'   THEN 1
      WHEN 'lessons_missing'   THEN 2
      WHEN 'lessons_not_ready' THEN 3
      WHEN 'questions_missing' THEN 4
      WHEN 'pricing_missing'   THEN 5
      ELSE 9 END,
    s.package_title
  LIMIT GREATEST(1, COALESCE(p_limit, 200));
$$;

REVOKE ALL ON FUNCTION public.admin_get_content_sellability_gaps(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_content_sellability_gaps(text, int) TO authenticated, service_role;

-- 4) RPC: per-package dispatch
CREATE OR REPLACE FUNCTION public.admin_content_sellability_dispatch(
  p_package_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_job_type text;
  v_active_jobs int;
  v_job_id uuid;
  v_now timestamptz := now();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_row FROM public.v_package_sellability_v1 WHERE package_id = p_package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'package_not_found');
  END IF;

  IF v_row.gap_class = 'sellable' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_sellable');
  END IF;

  IF v_row.gap_class IN ('pricing_missing','questions_missing') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'out_of_scope_for_m9', 'gap_class', v_row.gap_class);
  END IF;

  -- Map content gap → job type
  v_job_type := CASE v_row.gap_class
    WHEN 'modules_missing'   THEN 'package_scaffold_learning_course'
    WHEN 'lessons_missing'   THEN 'package_generate_learning_content'
    WHEN 'lessons_not_ready' THEN 'package_repair_failed_lessons'
    ELSE NULL END;

  IF v_job_type IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no_repair_mapping', 'gap_class', v_row.gap_class);
  END IF;

  -- Block on active job of same type
  SELECT COUNT(*) INTO v_active_jobs
  FROM public.job_queue
  WHERE payload->>'package_id' = p_package_id::text
    AND job_type = v_job_type
    AND status IN ('pending','queued','processing');

  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'active_job_present', 'job_type', v_job_type);
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'would_enqueue', v_job_type, 'gap_class', v_row.gap_class);
  END IF;

  INSERT INTO public.job_queue (job_type, status, payload, priority, created_at)
  VALUES (
    v_job_type,
    'pending',
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_row.curriculum_id,
      '_origin', 'm9_content_sellability_dispatch',
      'gap_class', v_row.gap_class
    ),
    50,
    v_now
  )
  RETURNING id INTO v_job_id;

  INSERT INTO public.auto_heal_log (
    trigger_source, action_type, target_id, target_type, input_params, result_status, result_detail
  ) VALUES (
    'admin_m9', 'm9_content_sellability_dispatch', p_package_id, 'package',
    jsonb_build_object('gap_class', v_row.gap_class, 'job_type', v_job_type),
    'success',
    jsonb_build_object('job_id', v_job_id)
  );

  RETURN jsonb_build_object(
    'dispatched', true,
    'job_id', v_job_id,
    'job_type', v_job_type,
    'gap_class', v_row.gap_class
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_content_sellability_dispatch(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_content_sellability_dispatch(uuid, boolean) TO authenticated, service_role;

-- 5) RPC: batch backfill (WIP-capped)
CREATE OR REPLACE FUNCTION public.admin_content_sellability_backfill(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_details jsonb := '[]'::jsonb;
  v_res jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR auth.role() = 'service_role') THEN
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
    IF (v_res->>'dispatched')::boolean THEN
      v_dispatched := v_dispatched + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log (
    trigger_source, action_type, target_type, input_params, result_status, result_detail
  ) VALUES (
    'admin_m9', 'm9_content_sellability_backfill', 'system',
    jsonb_build_object('limit', p_limit, 'dry_run', p_dry_run),
    'success',
    jsonb_build_object('dispatched', v_dispatched, 'skipped', v_skipped)
  );

  RETURN jsonb_build_object(
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'dry_run', p_dry_run,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_content_sellability_backfill(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_content_sellability_backfill(int, boolean) TO authenticated, service_role;