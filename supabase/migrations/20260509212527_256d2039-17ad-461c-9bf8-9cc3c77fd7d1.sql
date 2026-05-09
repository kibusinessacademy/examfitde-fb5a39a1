
CREATE OR REPLACE FUNCTION public.fn_handbook_publish_policy(p_track text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(coalesce(p_track,'AUSBILDUNG_VOLL'))
    WHEN 'EXAM_FIRST' THEN jsonb_build_object('track','EXAM_FIRST','allowed',false,'requires_handbook',false,'gates',jsonb_build_array('TRACK_DISALLOWS_HANDBOOK'))
    WHEN 'EXAM_FIRST_PLUS' THEN jsonb_build_object('track','EXAM_FIRST_PLUS','allowed',true,'requires_handbook',true,'gates',jsonb_build_array('PACKAGE_PUBLISHED_OR_DONE','GENERATE_HANDBOOK_DONE','VALIDATE_HANDBOOK_DONE','CHAPTER_HAS_TITLE','CHAPTER_HAS_CONTENT','NO_QUALITY_BLOCK'))
    WHEN 'STUDIUM' THEN jsonb_build_object('track','STUDIUM','allowed',true,'requires_handbook',true,'gates',jsonb_build_array('PACKAGE_PUBLISHED_OR_DONE','GENERATE_HANDBOOK_DONE','VALIDATE_HANDBOOK_DONE','CHAPTER_HAS_TITLE','CHAPTER_HAS_CONTENT','NO_QUALITY_BLOCK'))
    ELSE jsonb_build_object('track','AUSBILDUNG_VOLL','allowed',true,'requires_handbook',true,'gates',jsonb_build_array('PACKAGE_PUBLISHED_OR_DONE','GENERATE_HANDBOOK_DONE','VALIDATE_HANDBOOK_DONE','CHAPTER_HAS_TITLE','CHAPTER_HAS_CONTENT','NO_QUALITY_BLOCK'))
  END
$$;
GRANT EXECUTE ON FUNCTION public.fn_handbook_publish_policy(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_handbook_chapter_publishable(p_chapter_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ch AS (SELECT hc.id, hc.title, hc.curriculum_id FROM public.handbook_chapters hc WHERE hc.id = p_chapter_id),
  pkg AS (
    SELECT cp.id AS package_id, cp.status, cp.feature_flags, cp.track::text AS track_text
    FROM public.course_packages cp
    WHERE cp.curriculum_id = (SELECT curriculum_id FROM ch)
    ORDER BY (cp.status='published') DESC, cp.created_at DESC NULLS LAST LIMIT 1
  ),
  steps AS (
    SELECT bool_or(step_key='generate_handbook' AND status='done') AS gen_done,
           bool_or(step_key='validate_handbook' AND status='done') AS val_done
    FROM public.package_steps WHERE package_id = (SELECT package_id FROM pkg)
  ),
  sect AS (
    SELECT COUNT(*) AS c FROM public.handbook_sections hs
    WHERE hs.chapter_id = p_chapter_id
      AND COALESCE(NULLIF(trim(hs.basis_content),''), NULLIF(trim(hs.content_markdown),'')) IS NOT NULL
  )
  SELECT
    COALESCE((public.fn_handbook_publish_policy((SELECT track_text FROM pkg))->>'allowed')::boolean, false)
    AND (SELECT title IS NOT NULL AND length(trim(title)) > 0 FROM ch)
    AND (SELECT status IN ('published','done') FROM pkg)
    AND COALESCE((SELECT gen_done FROM steps), false)
    AND COALESCE((SELECT val_done FROM steps), false)
    AND (SELECT c FROM sect) > 0
    AND NOT COALESCE(((SELECT feature_flags FROM pkg)->>'handbook_quality_block')::boolean, false)
$$;
REVOKE ALL ON FUNCTION public.fn_handbook_chapter_publishable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_handbook_chapter_publishable(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_rollback_handbook_chapters_publish(
  p_package_id uuid, p_reason text DEFAULT 'manual_rollback', p_chapter_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid(); v_is_admin boolean := false;
  v_curriculum uuid; v_before integer := 0; v_unpublished integer := 0; v_after integer := 0;
  v_result jsonb;
BEGIN
  IF v_caller IS NOT NULL THEN SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin; END IF;
  IF NOT v_is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_package_id IS NULL THEN RAISE EXCEPTION 'package_id required'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'reason required (>=5 chars)'; END IF;

  SELECT curriculum_id INTO v_curriculum FROM public.course_packages WHERE id = p_package_id;
  IF v_curriculum IS NULL THEN RAISE EXCEPTION 'package has no curriculum_id'; END IF;

  SELECT COUNT(*) INTO v_before FROM public.handbook_chapters
   WHERE curriculum_id = v_curriculum AND is_published = true;

  WITH upd AS (
    UPDATE public.handbook_chapters hc SET is_published = false, updated_at = now()
    WHERE hc.curriculum_id = v_curriculum AND hc.is_published = true
      AND (p_chapter_ids IS NULL OR hc.id = ANY(p_chapter_ids))
    RETURNING hc.id
  ) SELECT COUNT(*) INTO v_unpublished FROM upd;

  SELECT COUNT(*) INTO v_after FROM public.handbook_chapters
   WHERE curriculum_id = v_curriculum AND is_published = true;

  v_result := jsonb_build_object('package_id',p_package_id,'curriculum_id',v_curriculum,'reason',p_reason,
    'chapter_filter',p_chapter_ids,'before_published',v_before,'unpublished',v_unpublished,
    'after_published',v_after,'caller',v_caller,'ts',now());

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, metadata)
  VALUES ('handbook_publish_rollback', p_package_id, 'package',
          CASE WHEN v_unpublished > 0 THEN 'success' ELSE 'noop' END, v_result);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_rollback_handbook_chapters_publish(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rollback_handbook_chapters_publish(uuid, text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_auto_publish_handbook_on_step_done()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_curr uuid; v_count integer := 0;
BEGIN
  IF NEW.step_key NOT IN ('quality_council','auto_publish') THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT curriculum_id INTO v_curr FROM public.course_packages WHERE id = NEW.package_id;
  IF v_curr IS NULL THEN RETURN NEW; END IF;

  WITH upd AS (
    UPDATE public.handbook_chapters hc SET is_published = true, updated_at = now()
    WHERE hc.curriculum_id = v_curr AND COALESCE(hc.is_published, false) = false
      AND public.fn_handbook_chapter_publishable(hc.id) = true
    RETURNING hc.id
  ) SELECT COUNT(*) INTO v_count FROM upd;

  IF v_count > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, metadata)
    VALUES ('handbook_auto_publish_on_step_done', NEW.package_id, 'package', 'success',
      jsonb_build_object('package_id',NEW.package_id,'curriculum_id',v_curr,'step_key',NEW.step_key,'chapters_published',v_count));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_handbook_auto_publish_on_step_done ON public.package_steps;
CREATE TRIGGER trg_handbook_auto_publish_on_step_done
AFTER UPDATE OF status ON public.package_steps
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_publish_handbook_on_step_done();

CREATE OR REPLACE FUNCTION public.admin_get_handbook_publish_drift_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller uuid := auth.uid(); v_is_admin boolean := false; v_summary jsonb; v_policies jsonb; v_last_actions jsonb;
BEGIN
  IF v_caller IS NOT NULL THEN SELECT public.has_role(v_caller,'admin'::app_role) INTO v_is_admin; END IF;
  IF NOT v_is_admin AND current_setting('role',true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_object_agg(t, public.fn_handbook_publish_policy(t)) INTO v_policies
  FROM unnest(ARRAY['AUSBILDUNG_VOLL','EXAM_FIRST','EXAM_FIRST_PLUS','STUDIUM']) AS t;

  SELECT jsonb_agg(row) INTO v_last_actions FROM (
    SELECT jsonb_build_object('action_type',action_type,'result_status',result_status,
      'target_id',target_id,'created_at',created_at,'metadata',metadata) AS row
    FROM public.auto_heal_log
    WHERE action_type IN ('handbook_publish_backfill','handbook_auto_publish_on_pkg_publish',
      'handbook_auto_publish_on_step_done','handbook_publish_rollback','handbook_publish_smoke')
    ORDER BY created_at DESC LIMIT 10
  ) t;

  SELECT jsonb_build_object(
    'drift_packages', COUNT(*),
    'chapters_publishable_pending', COALESCE(SUM(publishable_count - published_count), 0),
    'top_offenders', COALESCE((
      SELECT jsonb_agg(row) FROM (
        SELECT jsonb_build_object('package_id',package_id,'package_title',package_title,
          'chapter_count',chapter_count,'published_count',published_count,
          'publishable_count',publishable_count,'blocker_reason',blocker_reason) AS row
        FROM public.v_handbook_publish_drift_alerts
        ORDER BY (publishable_count - published_count) DESC LIMIT 25
      ) t), '[]'::jsonb),
    'policies', v_policies,
    'recent_actions', COALESCE(v_last_actions,'[]'::jsonb)
  ) INTO v_summary FROM public.v_handbook_publish_drift_alerts;
  RETURN v_summary;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_handbook_publish_drift_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_handbook_publish_drift_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_smoke_handbook_publish_policy()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid(); v_is_admin boolean := false;
  v_curr uuid; v_pkg uuid; v_ch_pub uuid; v_ch_block uuid; v_ch_empty uuid;
  v_results jsonb := '[]'::jsonb; v_pass boolean := true;
  r_publishable boolean; r_blocked boolean; r_empty boolean; r_after_rollback integer;
BEGIN
  IF v_caller IS NOT NULL THEN SELECT public.has_role(v_caller,'admin'::app_role) INTO v_is_admin; END IF;
  IF NOT v_is_admin AND current_setting('role',true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

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
REVOKE ALL ON FUNCTION public.admin_smoke_handbook_publish_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_handbook_publish_policy() TO authenticated, service_role;
