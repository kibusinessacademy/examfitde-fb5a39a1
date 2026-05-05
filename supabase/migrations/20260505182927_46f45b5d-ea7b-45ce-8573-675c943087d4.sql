
CREATE OR REPLACE FUNCTION public.admin_completion_burst(_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_row record;
  v_skel jsonb;
  v_minc jsonb;
  v_processed int := 0;
  v_skipped int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
         OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  FOR v_row IN
    SELECT c.id AS course_id, c.title,
      (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id=l.module_id 
        WHERE m.course_id=c.id AND (l.status='ready' OR l.generation_status='completed')) AS ready,
      (SELECT cp.id FROM course_packages cp WHERE cp.curriculum_id=c.curriculum_id 
        ORDER BY (cp.status='published') DESC, cp.created_at DESC LIMIT 1) AS pkg_id
    FROM courses c
    JOIN products p ON p.curriculum_id=c.curriculum_id
    WHERE c.status='published' AND p.status='active'
      AND EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id=p.id AND pp.active=true AND pp.stripe_price_id IS NOT NULL)
    ORDER BY (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id=l.module_id 
              WHERE m.course_id=c.id AND (l.status='ready' OR l.generation_status='completed')) DESC,
             (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=c.id) DESC
    LIMIT _limit
  LOOP
    -- skip if active jobs already running
    IF EXISTS (
      SELECT 1 FROM job_queue jq WHERE jq.package_id=v_row.pkg_id
        AND jq.status IN ('pending','processing')
        AND jq.job_type IN ('package_generate_learning_content','package_repair_failed_lessons',
                            'lesson_generate_content','package_generate_lesson_minichecks')
    ) THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('course_id', v_row.course_id, 'title', v_row.title,
        'skipped', 'active_jobs');
      CONTINUE;
    END IF;

    BEGIN
      v_skel := public.admin_requeue_skeleton_backfill_jobs_for_course(v_row.course_id);
    EXCEPTION WHEN OTHERS THEN v_skel := jsonb_build_object('error', SQLERRM); END;

    BEGIN
      v_minc := public.admin_requeue_minicheck_jobs_for_course(v_row.course_id);
    EXCEPTION WHEN OTHERS THEN v_minc := jsonb_build_object('error', SQLERRM); END;

    v_processed := v_processed + 1;
    v_results := v_results || jsonb_build_object(
      'course_id', v_row.course_id, 'title', v_row.title, 'lessons_ready', v_row.ready,
      'package_id', v_row.pkg_id, 'skeleton', v_skel, 'minicheck', v_minc);
  END LOOP;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('completion_burst_run','system','success',
    jsonb_build_object('processed', v_processed, 'skipped', v_skipped, 'limit', _limit));

  RETURN jsonb_build_object('ok', true, 'processed', v_processed, 'skipped', v_skipped,
    'limit', _limit, 'results', v_results);
END $$;

REVOKE ALL ON FUNCTION public.admin_completion_burst(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_completion_burst(int) TO authenticated, service_role;
