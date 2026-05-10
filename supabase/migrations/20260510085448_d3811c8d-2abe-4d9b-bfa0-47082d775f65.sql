-- Cron-driven daily parity check + audit + read-only summary RPC.
-- One concern: automated lesson-join parity surveillance.

-- 1) Worker function: runs the parity check service-role-side and audits result.
CREATE OR REPLACE FUNCTION public.fn_run_lesson_join_parity_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mismatches jsonb;
  v_count      integer;
  v_started    timestamptz := clock_timestamp();
BEGIN
  -- Inline parity (does NOT call admin_check_lesson_join_parity to skip has_role gate).
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
    SELECT p.id AS package_id, p.title,
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
           'delta', delta
         ) ORDER BY abs(delta) DESC), '[]'::jsonb),
         COUNT(*)
    INTO v_mismatches, v_count
    FROM diffs;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata, duration_ms)
  VALUES (
    'lesson_join_parity_check',
    'system',
    CASE WHEN v_count = 0 THEN 'ok' ELSE 'mismatch' END,
    CASE WHEN v_count = 0 THEN 'parity_clean' ELSE format('%s package(s) mismatched', v_count) END,
    jsonb_build_object(
      'mismatch_count', v_count,
      'mismatches', v_mismatches,
      'checked_at', now()
    ),
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::int
  );

  RETURN jsonb_build_object('mismatch_count', v_count, 'mismatches', v_mismatches);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_run_lesson_join_parity_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_lesson_join_parity_check() TO service_role;

-- 2) Read-only summary for cockpit (admin-gated).
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
    'duration_ms', l.duration_ms
  )
  INTO v
  FROM auto_heal_log l
  WHERE l.action_type = 'lesson_join_parity_check'
  ORDER BY l.created_at DESC
  LIMIT 1;

  RETURN COALESCE(v, jsonb_build_object('last_run_at', null, 'mismatch_count', 0, 'mismatches', '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lesson_join_parity_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lesson_join_parity_summary() TO authenticated;

-- 3) Schedule: daily at 03:17 UTC.
DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'lesson-join-parity-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  PERFORM cron.schedule(
    'lesson-join-parity-daily',
    '17 3 * * *',
    $cron$ SELECT public.fn_run_lesson_join_parity_check(); $cron$
  );
END $$;

-- 4) Smoke: run once now so summary is non-empty + we see immediate result.
SELECT public.fn_run_lesson_join_parity_check();