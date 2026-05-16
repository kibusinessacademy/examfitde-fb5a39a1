-- Extend guard_sealed_course to honor a narrowly-scoped, per-session bypass flag.
-- Only the M9.3b repair RPC may set this flag (LOCAL=true, dies with the transaction).
CREATE OR REPLACE FUNCTION public.guard_sealed_course()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_course_status text;
  v_autopilot_status text;
  v_bypass text;
BEGIN
  -- Per-session bypass flag (LOCAL=true). Only set by SECURITY DEFINER repair fns.
  BEGIN
    v_bypass := current_setting('app.m9_3b_allow_sealed_lessons_repair', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' AND TG_TABLE_NAME = 'lessons' AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'lessons' THEN
    SELECT c.status, c.autopilot_status
    INTO v_course_status, v_autopilot_status
    FROM courses c
    JOIN modules m ON m.course_id = c.id
    WHERE m.id = COALESCE(NEW.module_id, OLD.module_id);
  ELSIF TG_TABLE_NAME = 'modules' THEN
    SELECT c.status, c.autopilot_status
    INTO v_course_status, v_autopilot_status
    FROM courses c
    WHERE c.id = COALESCE(NEW.course_id, OLD.course_id);
  END IF;

  IF v_autopilot_status = 'sealed' THEN
    RAISE EXCEPTION 'SEALED_COURSE: Kurs ist versiegelt. Keine Änderungen erlaubt. Bitte erstellen Sie eine neue Version.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

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

  -- Narrow bypass: only valid for this transaction, only honored by guard_sealed_course.
  PERFORM set_config('app.m9_3b_allow_sealed_lessons_repair', 'on', true);

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
    'autopilot_status', v_autopilot,
    'total_lessons', v_total,
    'lessons_with_content', v_with_content,
    'lessons_flipped', v_flipped,
    'bypass', 'guard_sealed_course_via_app_flag'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_m9_repair_lessons_for_package(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_m9_repair_lessons_for_package(uuid) TO service_role;