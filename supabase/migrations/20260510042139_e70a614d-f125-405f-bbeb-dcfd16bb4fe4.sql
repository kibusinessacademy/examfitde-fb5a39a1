
DROP VIEW IF EXISTS public.v_handbook_publish_drift_alerts CASCADE;
DROP VIEW IF EXISTS public.v_handbook_publish_drift CASCADE;

-- 1. Policy
CREATE OR REPLACE FUNCTION public.fn_handbook_publish_policy(p_track text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(coalesce(p_track,'AUSBILDUNG_VOLL'))
    WHEN 'EXAM_FIRST' THEN jsonb_build_object(
      'track','EXAM_FIRST','allowed',true,'required',false,'requires_handbook',false,
      'gates',jsonb_build_array('CHAPTER_HAS_TITLE','CHAPTER_HAS_CONTENT','PACKAGE_PUBLISHED_OR_DONE'))
    WHEN 'EXAM_FIRST_PLUS' THEN jsonb_build_object(
      'track','EXAM_FIRST_PLUS','allowed',true,'required',true,'requires_handbook',true,
      'gates',jsonb_build_array('PACKAGE_PUBLISHED_OR_DONE','GENERATE_HANDBOOK_DONE','VALIDATE_HANDBOOK_DONE','CHAPTER_HAS_TITLE','CHAPTER_HAS_CONTENT','NO_QUALITY_BLOCK'))
    WHEN 'STUDIUM' THEN jsonb_build_object(
      'track','STUDIUM','allowed',true,'required',true,'requires_handbook',true,
      'gates',jsonb_build_array('PACKAGE_PUBLISHED_OR_DONE','GENERATE_HANDBOOK_DONE','VALIDATE_HANDBOOK_DONE','CHAPTER_HAS_TITLE','CHAPTER_HAS_CONTENT','NO_QUALITY_BLOCK'))
    ELSE jsonb_build_object(
      'track','AUSBILDUNG_VOLL','allowed',true,'required',true,'requires_handbook',true,
      'gates',jsonb_build_array('PACKAGE_PUBLISHED_OR_DONE','GENERATE_HANDBOOK_DONE','VALIDATE_HANDBOOK_DONE','CHAPTER_HAS_TITLE','CHAPTER_HAS_CONTENT','NO_QUALITY_BLOCK'))
  END
$$;
GRANT EXECUTE ON FUNCTION public.fn_handbook_publish_policy(text) TO authenticated, service_role;

-- 2. publishable function
CREATE OR REPLACE FUNCTION public.fn_handbook_chapter_publishable(p_chapter_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ch AS (SELECT hc.id, hc.title, hc.curriculum_id FROM public.handbook_chapters hc WHERE hc.id = p_chapter_id),
  pkg AS (
    SELECT cp.id AS package_id, cp.status, cp.feature_flags, cp.track::text AS track_text
    FROM public.course_packages cp
    WHERE cp.curriculum_id = (SELECT curriculum_id FROM ch)
    ORDER BY (cp.status='published') DESC, cp.created_at DESC NULLS LAST LIMIT 1
  ),
  pol AS (SELECT public.fn_handbook_publish_policy((SELECT track_text FROM pkg)) AS p),
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
    COALESCE(((SELECT p FROM pol)->>'allowed')::boolean, false)
    AND (SELECT title IS NOT NULL AND length(trim(title)) > 0 FROM ch)
    AND (SELECT status IN ('published','done') FROM pkg)
    AND (SELECT c FROM sect) > 0
    AND NOT COALESCE(((SELECT feature_flags FROM pkg)->>'handbook_quality_block')::boolean, false)
    AND (
      NOT COALESCE(((SELECT p FROM pol)->>'required')::boolean, true)
      OR (COALESCE((SELECT gen_done FROM steps), false) AND COALESCE((SELECT val_done FROM steps), false))
    )
$$;
REVOKE ALL ON FUNCTION public.fn_handbook_chapter_publishable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_handbook_chapter_publishable(uuid) TO authenticated, service_role;

-- 3. drift view + alerts
CREATE VIEW public.v_handbook_publish_drift AS
WITH pkg_chapters AS (
  SELECT cp.id AS package_id, cp.curriculum_id, cp.title AS package_title,
         cp.status AS package_status, cp.feature_flags, cp.track::text AS track,
         hc.id AS chapter_id, hc.is_published, hc.title AS chapter_title,
         (EXISTS (SELECT 1 FROM public.handbook_sections hs
                   WHERE hs.chapter_id = hc.id
                     AND COALESCE(NULLIF(trim(hs.basis_content),''), NULLIF(trim(hs.content_markdown),'')) IS NOT NULL)) AS has_content
  FROM public.course_packages cp
  LEFT JOIN public.handbook_chapters hc ON hc.curriculum_id = cp.curriculum_id
), steps_agg AS (
  SELECT package_id,
         bool_or(step_key='generate_handbook' AND status='done') AS gen_done,
         bool_or(step_key='validate_handbook' AND status='done') AS val_done
  FROM public.package_steps
  WHERE step_key = ANY(ARRAY['generate_handbook','validate_handbook'])
  GROUP BY package_id
)
SELECT pc.package_id, pc.curriculum_id, pc.package_title, pc.package_status, pc.track,
  COALESCE((public.fn_handbook_publish_policy(pc.track)->>'allowed')::boolean, false) AS allowed,
  COALESCE((public.fn_handbook_publish_policy(pc.track)->>'required')::boolean, true) AS required,
  COUNT(pc.chapter_id) AS chapter_count,
  COUNT(*) FILTER (WHERE pc.is_published) AS published_count,
  COUNT(*) FILTER (
    WHERE pc.chapter_title IS NOT NULL AND length(trim(pc.chapter_title)) > 0
      AND pc.has_content
      AND pc.package_status = ANY(ARRAY['published','done'])
      AND COALESCE((public.fn_handbook_publish_policy(pc.track)->>'allowed')::boolean,false)
      AND NOT COALESCE((pc.feature_flags->>'handbook_quality_block')::boolean,false)
      AND (
        NOT COALESCE((public.fn_handbook_publish_policy(pc.track)->>'required')::boolean,true)
        OR (COALESCE(sa.gen_done,false) AND COALESCE(sa.val_done,false))
      )
  ) AS publishable_count,
  CASE
    WHEN NOT COALESCE((public.fn_handbook_publish_policy(pc.track)->>'allowed')::boolean,false) THEN 'TRACK_DISALLOWED'
    WHEN pc.package_status <> ALL(ARRAY['published','done']) THEN 'PACKAGE_NOT_PUBLISHED'
    WHEN COALESCE((public.fn_handbook_publish_policy(pc.track)->>'required')::boolean,true)
         AND NOT COALESCE(bool_and(sa.gen_done),false) THEN 'GENERATE_NOT_DONE'
    WHEN COALESCE((public.fn_handbook_publish_policy(pc.track)->>'required')::boolean,true)
         AND NOT COALESCE(bool_and(sa.val_done),false) THEN 'VALIDATE_NOT_DONE'
    WHEN COUNT(pc.chapter_id) = 0 THEN 'NO_CHAPTERS'
    WHEN COALESCE((pc.feature_flags->>'handbook_quality_block')::boolean,false) THEN 'QUALITY_BLOCK'
    WHEN COUNT(*) FILTER (WHERE pc.is_published) = 0 THEN 'DRIFT_NONE_PUBLISHED'
    WHEN COUNT(*) FILTER (WHERE pc.is_published) < COUNT(pc.chapter_id) THEN 'PARTIAL_PUBLISHED'
    ELSE 'OK'
  END AS blocker_reason
FROM pkg_chapters pc
LEFT JOIN steps_agg sa ON sa.package_id = pc.package_id
GROUP BY pc.package_id, pc.curriculum_id, pc.package_title, pc.package_status, pc.feature_flags, pc.track;

CREATE VIEW public.v_handbook_publish_drift_alerts AS
SELECT package_id, curriculum_id, package_title, package_status, track, allowed, required,
       chapter_count, published_count, publishable_count, blocker_reason
FROM public.v_handbook_publish_drift
WHERE package_status = ANY(ARRAY['published','done'])
  AND publishable_count > published_count;

REVOKE ALL ON public.v_handbook_publish_drift FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_handbook_publish_drift_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_handbook_publish_drift, public.v_handbook_publish_drift_alerts TO service_role;

-- 4. summary RPC enriched
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
          'track',track,'allowed',allowed,'required',required,
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

-- 5. Smoke fixture registry + hardened RPC
CREATE TABLE IF NOT EXISTS public._smoke_handbook_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  marker text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smoke_handbook_fixtures_run ON public._smoke_handbook_fixtures(run_id);
ALTER TABLE public._smoke_handbook_fixtures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service-role only" ON public._smoke_handbook_fixtures;
CREATE POLICY "service-role only" ON public._smoke_handbook_fixtures FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._smoke_handbook_cleanup(p_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_section_ids uuid[]; v_chapter_ids uuid[]; v_pkg_ids uuid[]; v_curr_ids uuid[];
BEGIN
  SELECT array_agg(entity_id) INTO v_section_ids FROM public._smoke_handbook_fixtures WHERE run_id=p_run_id AND entity_type='section';
  SELECT array_agg(entity_id) INTO v_chapter_ids FROM public._smoke_handbook_fixtures WHERE run_id=p_run_id AND entity_type='chapter';
  SELECT array_agg(entity_id) INTO v_pkg_ids     FROM public._smoke_handbook_fixtures WHERE run_id=p_run_id AND entity_type='package';
  SELECT array_agg(entity_id) INTO v_curr_ids    FROM public._smoke_handbook_fixtures WHERE run_id=p_run_id AND entity_type='curriculum';
  IF v_section_ids IS NOT NULL THEN DELETE FROM public.handbook_sections WHERE id = ANY(v_section_ids); END IF;
  IF v_chapter_ids IS NOT NULL THEN DELETE FROM public.handbook_chapters WHERE id = ANY(v_chapter_ids); END IF;
  IF v_pkg_ids IS NOT NULL THEN
    DELETE FROM public.package_steps WHERE package_id = ANY(v_pkg_ids);
    DELETE FROM public.course_packages WHERE id = ANY(v_pkg_ids);
  END IF;
  IF v_curr_ids IS NOT NULL THEN DELETE FROM public.curricula WHERE id = ANY(v_curr_ids); END IF;
  DELETE FROM public._smoke_handbook_fixtures WHERE run_id = p_run_id;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('handbook_publish_smoke_cleanup_error','system','failed',
    jsonb_build_object('run_id',p_run_id,'sqlerrm',SQLERRM));
END $$;

CREATE OR REPLACE FUNCTION public.admin_smoke_handbook_publish_policy()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid(); v_is_admin boolean := false;
  v_run uuid := gen_random_uuid();
  v_curr uuid; v_pkg uuid; v_ch_pub uuid; v_ch_block uuid; v_ch_empty uuid; v_sec1 uuid; v_sec2 uuid;
  v_marker text;
  v_results jsonb := '[]'::jsonb; v_pass boolean := true;
  r_publishable boolean; r_blocked boolean; r_empty boolean; r_after_rollback integer; r_exam_first boolean;
BEGIN
  IF v_caller IS NOT NULL THEN SELECT public.has_role(v_caller,'admin'::app_role) INTO v_is_admin; END IF;
  IF NOT v_is_admin AND current_setting('role',true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  v_marker := '__smoke_handbook_'||v_run::text||'__';
  v_curr := gen_random_uuid(); v_pkg := gen_random_uuid();

  BEGIN
    INSERT INTO public.curricula (id, name, exam_authority) VALUES (v_curr, v_marker, 'SMOKE');
    INSERT INTO public._smoke_handbook_fixtures(run_id,entity_type,entity_id,marker) VALUES (v_run,'curriculum',v_curr,v_marker);

    INSERT INTO public.course_packages (id, curriculum_id, title, status, track, feature_flags)
    VALUES (v_pkg, v_curr, v_marker, 'published', 'AUSBILDUNG_VOLL'::product_track, '{}'::jsonb);
    INSERT INTO public._smoke_handbook_fixtures(run_id,entity_type,entity_id,marker) VALUES (v_run,'package',v_pkg,v_marker);

    INSERT INTO public.package_steps (package_id, step_key, status) VALUES
      (v_pkg, 'generate_handbook', 'done'), (v_pkg, 'validate_handbook', 'done');

    INSERT INTO public.handbook_chapters (curriculum_id, chapter_key, title, sort_order, is_published)
    VALUES (v_curr, v_marker||'-ok', 'Smoke OK', 1, false) RETURNING id INTO v_ch_pub;
    INSERT INTO public._smoke_handbook_fixtures(run_id,entity_type,entity_id,marker) VALUES (v_run,'chapter',v_ch_pub,v_marker);
    INSERT INTO public.handbook_sections (chapter_id, sort_order, basis_content)
    VALUES (v_ch_pub, 1, 'real content here') RETURNING id INTO v_sec1;
    INSERT INTO public._smoke_handbook_fixtures(run_id,entity_type,entity_id,marker) VALUES (v_run,'section',v_sec1,v_marker);

    INSERT INTO public.handbook_chapters (curriculum_id, chapter_key, title, sort_order, is_published)
    VALUES (v_curr, v_marker||'-empty', 'Smoke Empty', 2, false) RETURNING id INTO v_ch_empty;
    INSERT INTO public._smoke_handbook_fixtures(run_id,entity_type,entity_id,marker) VALUES (v_run,'chapter',v_ch_empty,v_marker);

    INSERT INTO public.handbook_chapters (curriculum_id, chapter_key, title, sort_order, is_published)
    VALUES (v_curr, v_marker||'-blocked', 'Smoke Blocked', 3, false) RETURNING id INTO v_ch_block;
    INSERT INTO public._smoke_handbook_fixtures(run_id,entity_type,entity_id,marker) VALUES (v_run,'chapter',v_ch_block,v_marker);
    INSERT INTO public.handbook_sections (chapter_id, sort_order, basis_content)
    VALUES (v_ch_block, 1, 'content') RETURNING id INTO v_sec2;
    INSERT INTO public._smoke_handbook_fixtures(run_id,entity_type,entity_id,marker) VALUES (v_run,'section',v_sec2,v_marker);

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
    DELETE FROM public.package_steps WHERE package_id = v_pkg;
    SELECT public.fn_handbook_chapter_publishable(v_ch_pub) INTO r_exam_first;
    v_results := v_results || jsonb_build_object('test','exam_first_optional_publishable','pass', r_exam_first = true);
    IF r_exam_first IS DISTINCT FROM true THEN v_pass := false; END IF;
    UPDATE public.course_packages SET track = 'AUSBILDUNG_VOLL'::product_track WHERE id = v_pkg;
    INSERT INTO public.package_steps (package_id, step_key, status) VALUES
      (v_pkg, 'generate_handbook', 'done'), (v_pkg, 'validate_handbook', 'done');

    PERFORM public.admin_backfill_publishable_handbook_chapters(false, v_pkg);
    PERFORM public.admin_rollback_handbook_chapters_publish(v_pkg, 'smoke_test_rollback', NULL);
    SELECT COUNT(*) INTO r_after_rollback FROM public.handbook_chapters
    WHERE curriculum_id = v_curr AND is_published = true;
    v_results := v_results || jsonb_build_object('test','rollback_unpublishes_all','pass', r_after_rollback = 0);
    IF r_after_rollback <> 0 THEN v_pass := false; END IF;

    PERFORM public._smoke_handbook_cleanup(v_run);

    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES ('handbook_publish_smoke','system', CASE WHEN v_pass THEN 'success' ELSE 'failed' END,
      jsonb_build_object('run_id',v_run,'results',v_results,'pass',v_pass));
    RETURN jsonb_build_object('pass',v_pass,'run_id',v_run,'results',v_results,'ts',now());

  EXCEPTION WHEN OTHERS THEN
    PERFORM public._smoke_handbook_cleanup(v_run);
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES ('handbook_publish_smoke','system','failed',
      jsonb_build_object('run_id',v_run,'sqlerrm',SQLERRM,'partial_results',v_results));
    RAISE;
  END;
END $$;
REVOKE ALL ON FUNCTION public.admin_smoke_handbook_publish_policy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_handbook_publish_policy() TO authenticated, service_role;
