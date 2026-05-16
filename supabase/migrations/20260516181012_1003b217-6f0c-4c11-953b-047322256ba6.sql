-- M9.3b · Post-Publish Content-Repair Worker
-- Scope: only content_gap_published_locked. No package_pipeline_steps touched.
-- Idempotent per (package_id, repair_type). WIP-capped. Audit via post_publish_content_repair_*.

-- ── 1) Register new job types (canonical identity contract) ─────────────
INSERT INTO ops_job_type_registry (job_type, job_name, lane, pool, requires_package_id, is_governance, is_active, description, step_key)
VALUES
  ('post_publish_content_repair_lessons',  'post_publish_content_repair_lessons',  'control', 'default', true, false, true, 'M9.3b: flip lessons with content from draft → ready for published, pipeline-locked packages. Bypasses package_pipeline_steps.', NULL),
  ('post_publish_content_repair_scaffold', 'post_publish_content_repair_scaffold', 'control', 'default', true, false, true, 'M9.3b: scaffold missing course/modules/lessons for published, pipeline-locked packages (deferred handler).', NULL)
ON CONFLICT (job_type) DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

-- ── 2) Whitelist in job_type_policies (bypass cron + OPS guards on published packages)
INSERT INTO job_type_policies (job_type, can_run_when_not_building, exempt_from_auto_cancel, is_repair, worker_pool, zombie_timeout_minutes, notes)
VALUES
  ('post_publish_content_repair_lessons',  true, true, true, 'default', 15, 'M9.3b dedicated worker. Never blocked by building-state guards.'),
  ('post_publish_content_repair_scaffold', true, true, true, 'default', 30, 'M9.3b dedicated worker (scaffold path).')
ON CONFLICT (job_type) DO UPDATE SET
  can_run_when_not_building = true,
  exempt_from_auto_cancel = true,
  is_repair = true,
  worker_pool = 'default',
  notes = EXCLUDED.notes,
  updated_at = now();

-- ── 3) Dispatcher RPC ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_m9_post_publish_repair_dispatch(
  p_limit integer DEFAULT 10,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatched int := 0;
  v_skipped int := 0;
  v_wip_cap int := 10;
  v_wip_now int;
  v_capacity int;
  v_pkg record;
  v_jt text;
  v_idem text;
  v_active int;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Current in-flight M9.3b jobs
  SELECT count(*)::int INTO v_wip_now
  FROM job_queue
  WHERE job_type IN ('post_publish_content_repair_lessons','post_publish_content_repair_scaffold')
    AND status IN ('pending','processing');

  v_capacity := GREATEST(0, v_wip_cap - v_wip_now);
  IF v_capacity = 0 THEN
    RETURN jsonb_build_object(
      'dispatched', 0, 'skipped', 0, 'dry_run', p_dry_run,
      'wip_now', v_wip_now, 'wip_cap', v_wip_cap, 'reason', 'wip_cap_reached', 'rows', v_rows
    );
  END IF;

  FOR v_pkg IN
    SELECT s.package_id, s.package_title, s.track, s.course_id, s.modules, s.lessons, s.lessons_ready,
      CASE
        WHEN s.course_id IS NULL OR s.modules = 0 OR s.lessons = 0 THEN 'scaffold'
        ELSE 'repair_lessons'
      END AS repair_type
    FROM v_package_sellability_v1 s
    WHERE s.gap_class = 'content_gap_published_locked'
    ORDER BY (CASE WHEN s.course_id IS NULL OR s.modules = 0 OR s.lessons = 0 THEN 1 ELSE 0 END), s.package_title
    LIMIT LEAST(p_limit, v_capacity * 2)  -- consider more than cap so skips don't starve
  LOOP
    EXIT WHEN v_dispatched >= LEAST(p_limit, v_capacity);

    v_jt := CASE v_pkg.repair_type
              WHEN 'scaffold' THEN 'post_publish_content_repair_scaffold'
              ELSE 'post_publish_content_repair_lessons'
            END;

    v_idem := 'm9_3b:' || v_pkg.package_id::text || ':' || v_pkg.repair_type;

    -- Idempotency: skip if active job exists (pending/processing) with same idempotency_key
    SELECT count(*)::int INTO v_active
    FROM job_queue
    WHERE idempotency_key = v_idem
      AND status IN ('pending','processing');

    IF v_active > 0 THEN
      v_skipped := v_skipped + 1;
      v_rows := v_rows || jsonb_build_object(
        'package_id', v_pkg.package_id, 'package_title', v_pkg.package_title,
        'repair_type', v_pkg.repair_type, 'job_type', v_jt,
        'action', 'skipped', 'reason', 'active_job_exists'
      );
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_dispatched := v_dispatched + 1;
      v_rows := v_rows || jsonb_build_object(
        'package_id', v_pkg.package_id, 'package_title', v_pkg.package_title,
        'repair_type', v_pkg.repair_type, 'job_type', v_jt,
        'action', 'dry_run', 'idempotency_key', v_idem
      );
      CONTINUE;
    END IF;

    INSERT INTO job_queue (
      job_type, job_name, status, payload, idempotency_key,
      priority, run_after, max_attempts, attempts
    ) VALUES (
      v_jt, v_jt, 'pending',
      jsonb_build_object(
        'package_id', v_pkg.package_id,
        'curriculum_id', (SELECT curriculum_id FROM course_packages WHERE id = v_pkg.package_id),
        'repair_type', v_pkg.repair_type,
        'gap_class', 'content_gap_published_locked',
        'enqueue_source', 'm9_3b_dispatcher'
      ),
      v_idem,
      40, now(), 3, 0
    );

    v_dispatched := v_dispatched + 1;
    v_rows := v_rows || jsonb_build_object(
      'package_id', v_pkg.package_id, 'package_title', v_pkg.package_title,
      'repair_type', v_pkg.repair_type, 'job_type', v_jt,
      'action', 'enqueued', 'idempotency_key', v_idem
    );

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES (
      'post_publish_content_repair_dispatch', 'admin_m9_post_publish_repair_dispatch',
      'course_package', v_pkg.package_id, 'success',
      jsonb_build_object('repair_type', v_pkg.repair_type, 'job_type', v_jt, 'idempotency_key', v_idem)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'dispatched', v_dispatched, 'skipped', v_skipped, 'dry_run', p_dry_run,
    'wip_now', v_wip_now, 'wip_cap', v_wip_cap, 'capacity', v_capacity, 'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_m9_post_publish_repair_dispatch(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_m9_post_publish_repair_dispatch(integer, boolean) TO authenticated;

-- ── 4) Repair RPC for lessons handler (SECURITY DEFINER, called from edge fn) ─
-- Flips lessons with content from draft → ready for a given package's course.
-- Returns jsonb {flipped, total_with_content, total_lessons}.
CREATE OR REPLACE FUNCTION public.fn_m9_repair_lessons_for_package(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_curriculum_id uuid;
  v_flipped int := 0;
  v_total int := 0;
  v_with_content int := 0;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_or_curriculum_not_found');
  END IF;

  SELECT id INTO v_course_id
  FROM courses
  WHERE curriculum_id = v_curriculum_id AND status = 'published'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_course_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_published_course');
  END IF;

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE l.content IS NOT NULL AND l.content::text NOT IN ('{}','null'))::int
  INTO v_total, v_with_content
  FROM lessons l JOIN modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id;

  WITH upd AS (
    UPDATE lessons l
       SET status = 'ready',
           generation_status = 'completed'
      FROM modules m
     WHERE m.id = l.module_id
       AND m.course_id = v_course_id
       AND l.content IS NOT NULL
       AND l.content::text NOT IN ('{}','null')
       AND (l.status <> 'ready' OR COALESCE(l.generation_status,'') <> 'completed')
    RETURNING l.id
  )
  SELECT count(*)::int INTO v_flipped FROM upd;

  RETURN jsonb_build_object(
    'ok', true,
    'course_id', v_course_id,
    'total_lessons', v_total,
    'lessons_with_content', v_with_content,
    'lessons_flipped', v_flipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_m9_repair_lessons_for_package(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_m9_repair_lessons_for_package(uuid) TO service_role;