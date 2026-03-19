
CREATE OR REPLACE FUNCTION public.reconcile_legacy_content_steps(p_package_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_course_id uuid;
  v_curriculum_id uuid;
  v_total_lessons int;
  v_real_lessons int;
  v_broken_lessons int;
  v_coverage numeric;
  v_results jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_threshold numeric := 0.90;
  v_detail text;
BEGIN
  FOR v_pkg IN
    SELECT r.package_id, r.title, r.repair_class, r.gen_status
    FROM v_pipeline_repair_classification r
    WHERE r.repair_class IN ('B_LEGACY_REFINALIZE', 'B_ORCHESTRATION_DRIFT')
      AND (p_package_id IS NULL OR r.package_id = p_package_id)
    ORDER BY r.title
  LOOP
    SELECT cp.course_id, cp.curriculum_id
    INTO v_course_id, v_curriculum_id
    FROM course_packages cp
    WHERE cp.id = v_pkg.package_id;

    IF v_course_id IS NULL THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id, 'title', v_pkg.title,
        'action', 'skipped', 'reason', 'no_course_id');
      CONTINUE;
    END IF;

    -- Count total, real content, and broken lessons
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE length(COALESCE(l.content::text, '')) >= 300
                        AND l.content::text NOT LIKE '%%_placeholder%%'),
      COUNT(*) FILTER (WHERE l.content IS NULL
                        OR length(l.content::text) < 50
                        OR l.content::text LIKE '%%_placeholder%%'
                        OR (l.meta IS NOT NULL AND (
                          l.meta->>'tier1_failed' = 'true'
                          OR l.meta->>'_regenerating' = 'true'
                        )))
    INTO v_total_lessons, v_real_lessons, v_broken_lessons
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id;

    v_coverage := CASE WHEN v_total_lessons > 0
      THEN v_real_lessons::numeric / v_total_lessons ELSE 0 END;

    -- Guard requires 0 broken lessons for step=done
    IF v_coverage >= v_threshold AND v_total_lessons > 0 AND v_broken_lessons = 0 THEN
      -- Use SET LOCAL to bypass guard in controlled reconciliation
      PERFORM set_config('app.reconcile_bypass', 'on', true);

      UPDATE package_steps
      SET status = 'done', updated_at = v_now,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'reconciled_at', v_now, 'reconcile_source', 'legacy_path',
            'total_lessons', v_total_lessons, 'real_lessons', v_real_lessons,
            'coverage', round(v_coverage * 100, 1))
      WHERE package_id = v_pkg.package_id
        AND step_key = 'generate_learning_content'
        AND status != 'done';

      PERFORM set_config('app.reconcile_bypass', 'off', true);

      UPDATE package_steps
      SET status = 'queued', updated_at = v_now
      WHERE package_id = v_pkg.package_id
        AND step_key = 'validate_learning_content'
        AND status NOT IN ('done', 'running', 'enqueued');

      v_detail := v_real_lessons || '/' || v_total_lessons || ' lessons — marked done';

      INSERT INTO auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
      VALUES ('reconcile_legacy_content', 'course_package', v_pkg.package_id::text,
        'reconcile_legacy_content_steps', 'healed', v_detail,
        jsonb_build_object('coverage', round(v_coverage * 100, 1),
          'real_lessons', v_real_lessons, 'total_lessons', v_total_lessons,
          'repair_class', v_pkg.repair_class));

      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id, 'title', v_pkg.title,
        'action', 'healed', 'coverage', round(v_coverage * 100, 1),
        'real_lessons', v_real_lessons, 'total_lessons', v_total_lessons);

    ELSIF v_coverage >= v_threshold AND v_broken_lessons > 0 THEN
      -- Content mostly done but some broken lessons block the guard
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id, 'title', v_pkg.title,
        'action', 'blocked_by_guard',
        'broken_lessons', v_broken_lessons,
        'coverage', round(v_coverage * 100, 1),
        'real_lessons', v_real_lessons, 'total_lessons', v_total_lessons);
    ELSE
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id, 'title', v_pkg.title,
        'action', 'insufficient_coverage', 'coverage', round(v_coverage * 100, 1),
        'real_lessons', v_real_lessons, 'total_lessons', v_total_lessons,
        'broken_lessons', v_broken_lessons);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reconciled', v_results);
END;
$$;
