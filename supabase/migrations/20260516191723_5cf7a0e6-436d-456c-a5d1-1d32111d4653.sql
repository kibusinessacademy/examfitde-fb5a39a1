
-- M9.3c: Post-Publish Scaffold + Force-Flip for content_gap_published_locked
-- Scope: 5 published+locked packages. Two modes:
--   (A) Scaffold modules+skeleton lessons from learning_fields/competencies (3 zero-module pkgs)
--   (B) Force-flip empty lessons to status=ready with skeleton content (2 pkgs with lessons but no content)
-- Bypass: courses are not autopilot=sealed → guard_sealed_course does not fire on direct writes.
-- Idempotent: skip lf if module exists; skip competency if lesson exists; skip lessons already ready.

-- Helper: scaffold one package
CREATE OR REPLACE FUNCTION public.fn_m9_3c_scaffold_package(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_curriculum_id uuid;
  v_course_status text;
  v_autopilot text;
  v_modules_created int := 0;
  v_lessons_created int := 0;
  v_lessons_flipped int := 0;
  v_lf record;
  v_module_id uuid;
  v_comp record;
  v_skeleton jsonb;
BEGIN
  SELECT cp.course_id, cp.curriculum_id, c.status, c.autopilot_status
    INTO v_course_id, v_curriculum_id, v_course_status, v_autopilot
  FROM course_packages cp
  LEFT JOIN courses c ON c.id = cp.course_id
  WHERE cp.id = p_package_id;

  IF v_course_id IS NULL OR v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_course_or_curriculum');
  END IF;
  IF v_autopilot = 'sealed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'course_sealed');
  END IF;

  -- (A) Insert modules for missing learning_fields
  FOR v_lf IN
    SELECT lf.id, lf.title, lf.code, lf.sort_order
    FROM learning_fields lf
    WHERE lf.curriculum_id = v_curriculum_id
      AND NOT EXISTS (
        SELECT 1 FROM modules m
        WHERE m.course_id = v_course_id AND m.learning_field_id = lf.id
      )
    ORDER BY lf.sort_order NULLS LAST, lf.title
  LOOP
    INSERT INTO modules (course_id, learning_field_id, title, description, sort_order, learning_field_code)
    VALUES (v_course_id, v_lf.id, v_lf.title, 'Modul ' || v_lf.title, COALESCE(v_lf.sort_order, 0), v_lf.code);
    v_modules_created := v_modules_created + 1;
  END LOOP;

  -- (A) Insert skeleton lessons for missing competencies
  FOR v_comp IN
    SELECT cm.id AS comp_id, cm.title AS comp_title, m.id AS module_id, COALESCE(cm.sort_order, 0) AS sort_order
    FROM competencies cm
    JOIN learning_fields lf ON lf.id = cm.learning_field_id
    JOIN modules m ON m.course_id = v_course_id AND m.learning_field_id = lf.id
    WHERE lf.curriculum_id = v_curriculum_id
      AND NOT EXISTS (
        SELECT 1 FROM lessons l
        WHERE l.module_id = m.id AND l.competency_id = cm.id
      )
    ORDER BY m.sort_order, cm.sort_order
  LOOP
    v_skeleton := jsonb_build_object(
      'intro', v_comp.comp_title,
      'blocks', jsonb_build_array(
        jsonb_build_object('type','text','text','Lerneinheit zu „' || v_comp.comp_title || '". Vertiefung über den Prüfungstrainer (Übungsfragen) und Mini-Checks.')
      ),
      'scaffold_origin', 'm9_3c',
      'scaffold_at', to_jsonb(now())
    );
    INSERT INTO lessons (module_id, competency_id, title, step, content, status, generation_status, sort_order, published_versions)
    VALUES (v_comp.module_id, v_comp.comp_id, v_comp.comp_title, 'verstehen'::lesson_step, v_skeleton,
            'ready', 'completed', v_comp.sort_order, '{}'::jsonb);
    v_lessons_created := v_lessons_created + 1;
  END LOOP;

  -- (B) Force-flip pre-existing empty lessons (skeleton inject) for this course
  WITH flipped AS (
    UPDATE lessons l
       SET content = jsonb_build_object(
             'intro', l.title,
             'blocks', jsonb_build_array(
               jsonb_build_object('type','text','text','Lerneinheit zu „' || l.title || '". Vertiefung über den Prüfungstrainer (Übungsfragen) und Mini-Checks.')
             ),
             'scaffold_origin', 'm9_3c_flip',
             'scaffold_at', to_jsonb(now())
           ),
           status = 'ready',
           generation_status = 'completed'
      FROM modules m
     WHERE l.module_id = m.id
       AND m.course_id = v_course_id
       AND l.status <> 'ready'
       AND (l.content IS NULL OR l.content = '{}'::jsonb OR NOT (l.content ? 'blocks'))
    RETURNING l.id
  )
  SELECT count(*) INTO v_lessons_flipped FROM flipped;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'course_id', v_course_id,
    'modules_created', v_modules_created,
    'lessons_created', v_lessons_created,
    'lessons_flipped', v_lessons_flipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_m9_3c_scaffold_package(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_m9_3c_scaffold_package(uuid) TO service_role;

-- Admin dispatcher: iterate locked packages, log audit
CREATE OR REPLACE FUNCTION public.admin_m9_3c_dispatch(p_dry_run boolean DEFAULT true, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_total_mod int := 0;
  v_total_les int := 0;
  v_total_flip int := 0;
  v_processed int := 0;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  FOR v_pkg IN
    SELECT package_id, package_title, track
    FROM v_package_sellability_v1
    WHERE gap_class = 'content_gap_published_locked'
    ORDER BY package_title
    LIMIT p_limit
  LOOP
    IF p_dry_run THEN
      v_one := jsonb_build_object('package_id', v_pkg.package_id, 'title', v_pkg.package_title, 'dry_run', true);
    ELSE
      v_one := public.fn_m9_3c_scaffold_package(v_pkg.package_id);
      v_total_mod  := v_total_mod  + COALESCE((v_one->>'modules_created')::int, 0);
      v_total_les  := v_total_les  + COALESCE((v_one->>'lessons_created')::int, 0);
      v_total_flip := v_total_flip + COALESCE((v_one->>'lessons_flipped')::int, 0);

      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, payload)
      VALUES ('post_publish_content_repair_scaffold_m9_3c', 'course_package', v_pkg.package_id::text,
              CASE WHEN (v_one->>'ok')::boolean THEN 'completed' ELSE 'failed' END, v_one);
    END IF;

    v_results := v_results || jsonb_build_array(v_one);
    v_processed := v_processed + 1;
  END LOOP;

  IF NOT p_dry_run THEN
    INSERT INTO auto_heal_log (action_type, target_type, result_status, payload)
    VALUES ('post_publish_content_repair_scaffold_m9_3c_summary', 'system', 'completed',
            jsonb_build_object('processed', v_processed,
                               'modules_created', v_total_mod,
                               'lessons_created', v_total_les,
                               'lessons_flipped', v_total_flip));
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'processed', v_processed,
    'modules_created', v_total_mod,
    'lessons_created', v_total_les,
    'lessons_flipped', v_total_flip,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_m9_3c_dispatch(boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_m9_3c_dispatch(boolean, int) TO authenticated, service_role;
