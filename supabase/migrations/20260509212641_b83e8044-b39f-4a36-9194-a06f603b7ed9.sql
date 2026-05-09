
CREATE OR REPLACE FUNCTION public.admin_smoke_handbook_publish_policy()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid(); v_is_admin boolean := false; v_allowed boolean := false;
  v_curr uuid; v_pkg uuid; v_ch_pub uuid; v_ch_block uuid; v_ch_empty uuid;
  v_results jsonb := '[]'::jsonb; v_pass boolean := true;
  r_publishable boolean; r_blocked boolean; r_empty boolean; r_after_rollback integer;
BEGIN
  IF v_caller IS NOT NULL THEN SELECT public.has_role(v_caller,'admin'::app_role) INTO v_is_admin; END IF;
  v_allowed := v_is_admin
            OR current_setting('role', true) = 'service_role'
            OR current_setting('request.jwt.claim.role', true) = 'service_role'
            OR current_user IN ('postgres','supabase_admin');
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;

  v_curr := gen_random_uuid(); v_pkg := gen_random_uuid();
  INSERT INTO public.curricula (id, name, exam_authority) VALUES (v_curr, '__smoke_handbook__', 'SMOKE');
  INSERT INTO public.course_packages (id, curriculum_id, title, status, track, feature_flags)
  VALUES (v_pkg, v_curr, '__smoke_handbook_pkg__', 'published', 'AUSBILDUNG_VOLL'::product_track, '{}'::jsonb);
  INSERT INTO public.package_steps (package_id, step_key, status) VALUES
    (v_pkg, 'generate_handbook', 'done'), (v_pkg, 'validate_handbook', 'done');

  INSERT INTO public.handbook_chapters (curriculum_id, chapter_key, title, sort_order, is_published)
  VALUES (v_curr, 'smoke-ok', 'Smoke OK', 1, false) RETURNING id INTO v_ch_pub;
  INSERT INTO public.handbook_sections (chapter_id, sort_order, basis_content)
  VALUES (v_ch_pub, 1, 'real content here');

  INSERT INTO public.handbook_chapters (curriculum_id, chapter_key, title, sort_order, is_published)
  VALUES (v_curr, 'smoke-empty', 'Smoke Empty', 2, false) RETURNING id INTO v_ch_empty;

  INSERT INTO public.handbook_chapters (curriculum_id, chapter_key, title, sort_order, is_published)
  VALUES (v_curr, 'smoke-blocked', 'Smoke Blocked', 3, false) RETURNING id INTO v_ch_block;
  INSERT INTO public.handbook_sections (chapter_id, sort_order, basis_content)
  VALUES (v_ch_block, 1, 'content');

  SELECT public.fn_handbook_chapter_publishable(v_ch_pub) INTO r_publishable;
  v_results := v_results || jsonb_build_object('test','publishable_true','pass', r_publishable = true);
  IF r_publishable IS DISTINCT FROM true THEN v_pass := false; END IF;

  SELECT public.fn_handbook_chapter_publishable(v_ch_empty) INTO r_empty;
  v_results := v_results || jsonb_build_object('test','empty_false','pass', r_empty = false);
  IF r_empty IS DISTINCT FROM false THEN v_pass := false; END IF;

  UPDATE public.course_packages SET feature_flags = jsonb_set(feature_flags,'{handbook_quality_block}','true'::jsonb) WHERE id = v_pkg;
  SELECT public.fn_handbook_chapter_publishable(v_ch_block) INTO r_blocked;
  v_results := v_results || jsonb_build_object('test','quality_block_false','pass', r_blocked = false);
  IF r_blocked IS DISTINCT FROM false THEN v_pass := false; END IF;
  UPDATE public.course_packages SET feature_flags = jsonb_set(feature_flags,'{handbook_quality_block}','false'::jsonb) WHERE id = v_pkg;

  UPDATE public.course_packages SET track = 'EXAM_FIRST'::product_track WHERE id = v_pkg;
  SELECT public.fn_handbook_chapter_publishable(v_ch_pub) INTO r_publishable;
  v_results := v_results || jsonb_build_object('test','exam_first_disallow','pass', r_publishable = false);
  IF r_publishable IS DISTINCT FROM false THEN v_pass := false; END IF;
  UPDATE public.course_packages SET track = 'AUSBILDUNG_VOLL'::product_track WHERE id = v_pkg;

  PERFORM public.admin_backfill_publishable_handbook_chapters(false, v_pkg);
  PERFORM public.admin_rollback_handbook_chapters_publish(v_pkg, 'smoke_test_rollback', NULL);
  SELECT COUNT(*) INTO r_after_rollback FROM public.handbook_chapters
  WHERE curriculum_id = v_curr AND is_published = true;
  v_results := v_results || jsonb_build_object('test','rollback_unpublishes_all','pass', r_after_rollback = 0);
  IF r_after_rollback <> 0 THEN v_pass := false; END IF;

  DELETE FROM public.handbook_sections WHERE chapter_id IN (v_ch_pub, v_ch_block, v_ch_empty);
  DELETE FROM public.handbook_chapters WHERE id IN (v_ch_pub, v_ch_block, v_ch_empty);
  DELETE FROM public.package_steps WHERE package_id = v_pkg;
  DELETE FROM public.course_packages WHERE id = v_pkg;
  DELETE FROM public.curricula WHERE id = v_curr;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('handbook_publish_smoke','system', CASE WHEN v_pass THEN 'success' ELSE 'failed' END,
    jsonb_build_object('results',v_results,'pass',v_pass));
  RETURN jsonb_build_object('pass',v_pass,'results',v_results,'ts',now());
END $$;
GRANT EXECUTE ON FUNCTION public.admin_smoke_handbook_publish_policy() TO authenticated, service_role;
