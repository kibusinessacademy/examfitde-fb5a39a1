-- Lesson-join parity: auto-heal trigger + recommended_action surfaced in summary.
-- Single concern: when parity check finds mismatches, enqueue idempotent heal-runs
-- and expose the per-package recommended_action to the cockpit.

CREATE OR REPLACE FUNCTION public.fn_run_lesson_join_parity_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mismatches jsonb;
  v_count      integer;
  v_enqueued   integer := 0;
  v_skipped    integer := 0;
  v_started    timestamptz := clock_timestamp();
  r            record;
  v_recommended constant text := 'repair_lessons';
BEGIN
  -- Inline parity (skips has_role gate by design).
  WITH pkg AS (
    SELECT cp.id, cp.title, cp.curriculum_id, cp.course_id
    FROM course_packages cp
    WHERE cp.status::text = 'published'
  ),
  via_curr AS (
    SELECT p.id AS package_id, COUNT(l.id) AS n
    FROM pkg p
    LEFT JOIN courses  c ON c.curriculum_id = p.curriculum_id
    LEFT JOIN modules  m ON m.course_id = c.id
    LEFT JOIN lessons  l ON l.module_id = m.id
    GROUP BY p.id
  ),
  via_course AS (
    SELECT p.id AS package_id, COUNT(l.id) AS n
    FROM pkg p
    LEFT JOIN modules m ON m.course_id = p.course_id
    LEFT JOIN lessons l ON l.module_id = m.id
    GROUP BY p.id
  ),
  diffs AS (
    SELECT p.id AS package_id, p.title, p.curriculum_id,
           vc.n AS via_curriculum, vp.n AS via_package_course,
           (vc.n - vp.n) AS delta
    FROM pkg p
    JOIN via_curr   vc ON vc.package_id = p.id
    JOIN via_course vp ON vp.package_id = p.id
    WHERE vc.n <> vp.n
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'package_id', package_id,
           'title', title,
           'via_curriculum', via_curriculum,
           'via_package_course', via_package_course,
           'delta', delta,
           'recommended_action', v_recommended
         ) ORDER BY abs(delta) DESC), '[]'::jsonb),
         COUNT(*)
    INTO v_mismatches, v_count
    FROM diffs;

  -- Auto-heal enqueue: idempotent per package (skip if pending/processing exists).
  IF v_count > 0 THEN
    FOR r IN
      WITH pkg AS (
        SELECT cp.id, cp.curriculum_id, cp.course_id
        FROM course_packages cp
        WHERE cp.status::text = 'published'
      ),
      via_curr AS (
        SELECT p.id AS package_id, COUNT(l.id) AS n
        FROM pkg p
        LEFT JOIN courses c ON c.curriculum_id = p.curriculum_id
        LEFT JOIN modules m ON m.course_id = c.id
        LEFT JOIN lessons l ON l.module_id = m.id
        GROUP BY p.id
      ),
      via_course AS (
        SELECT p.id AS package_id, COUNT(l.id) AS n
        FROM pkg p
        LEFT JOIN modules m ON m.course_id = p.course_id
        LEFT JOIN lessons l ON l.module_id = m.id
        GROUP BY p.id
      )
      SELECT p.id AS package_id, p.curriculum_id, (vc.n - vp.n) AS delta
      FROM pkg p
      JOIN via_curr   vc ON vc.package_id = p.id
      JOIN via_course vp ON vp.package_id = p.id
      WHERE vc.n <> vp.n AND p.curriculum_id IS NOT NULL
    LOOP
      IF EXISTS (
        SELECT 1 FROM admin_course_auto_heal_queue q
        WHERE q.package_id = r.package_id
          AND q.heal_action = v_recommended
          AND q.source = 'lesson_join_parity'
          AND q.status IN ('pending','processing')
      ) THEN
        v_skipped := v_skipped + 1;
      ELSE
        INSERT INTO admin_course_auto_heal_queue
          (package_id, curriculum_id, source, reason_codes, heal_action, status, notes)
        VALUES
          (r.package_id, r.curriculum_id, 'lesson_join_parity',
           ARRAY['LESSON_JOIN_PARITY_MISMATCH'], v_recommended, 'pending',
           format('parity delta=%s (curriculum vs package_course path)', r.delta));
        v_enqueued := v_enqueued + 1;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata, duration_ms)
  VALUES (
    'lesson_join_parity_check',
    'system',
    CASE WHEN v_count = 0 THEN 'ok' ELSE 'mismatch' END,
    CASE WHEN v_count = 0
         THEN 'parity_clean'
         ELSE format('%s mismatch(es), enqueued=%s skipped=%s', v_count, v_enqueued, v_skipped)
    END,
    jsonb_build_object(
      'mismatch_count', v_count,
      'mismatches', v_mismatches,
      'recommended_action', v_recommended,
      'auto_heal_enqueued', v_enqueued,
      'auto_heal_skipped_existing', v_skipped,
      'checked_at', now()
    ),
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::int
  );

  RETURN jsonb_build_object(
    'mismatch_count', v_count,
    'mismatches', v_mismatches,
    'recommended_action', v_recommended,
    'auto_heal_enqueued', v_enqueued,
    'auto_heal_skipped_existing', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_run_lesson_join_parity_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_lesson_join_parity_check() TO service_role;

-- Summary RPC: include recommended_action + enqueue counters at top level.
CREATE OR REPLACE FUNCTION public.admin_get_lesson_join_parity_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'last_run_at', l.created_at,
    'result_status', l.result_status,
    'result_detail', l.result_detail,
    'mismatch_count', COALESCE((l.metadata->>'mismatch_count')::int, 0),
    'mismatches', COALESCE(l.metadata->'mismatches', '[]'::jsonb),
    'recommended_action', COALESCE(l.metadata->>'recommended_action', 'repair_lessons'),
    'auto_heal_enqueued', COALESCE((l.metadata->>'auto_heal_enqueued')::int, 0),
    'auto_heal_skipped_existing', COALESCE((l.metadata->>'auto_heal_skipped_existing')::int, 0),
    'duration_ms', l.duration_ms
  )
  INTO v
  FROM auto_heal_log l
  WHERE l.action_type = 'lesson_join_parity_check'
  ORDER BY l.created_at DESC
  LIMIT 1;

  RETURN COALESCE(v, jsonb_build_object(
    'last_run_at', null,
    'mismatch_count', 0,
    'mismatches', '[]'::jsonb,
    'recommended_action', 'repair_lessons',
    'auto_heal_enqueued', 0,
    'auto_heal_skipped_existing', 0
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lesson_join_parity_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lesson_join_parity_summary() TO authenticated;

-- Smoke run so cockpit reflects new shape immediately.
SELECT public.fn_run_lesson_join_parity_check();