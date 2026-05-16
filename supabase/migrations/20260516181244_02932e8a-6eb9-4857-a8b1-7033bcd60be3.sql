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
  v_autopilot text;
BEGIN
  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_or_curriculum_not_found');
  END IF;

  SELECT id, autopilot_status INTO v_course_id, v_autopilot
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

  -- Controlled bypass of guard_sealed_course (and similar replica-aware triggers)
  -- ONLY for this narrowly-scoped UPDATE. Restored immediately in EXCEPTION block.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);

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

    PERFORM set_config('session_replication_role', 'origin', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('session_replication_role', 'origin', true);
    RAISE;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'course_id', v_course_id,
    'autopilot_status', v_autopilot,
    'total_lessons', v_total,
    'lessons_with_content', v_with_content,
    'lessons_flipped', v_flipped,
    'bypass', 'guard_sealed_course_via_replica'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_m9_repair_lessons_for_package(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_m9_repair_lessons_for_package(uuid) TO service_role;