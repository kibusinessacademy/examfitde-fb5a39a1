-- Extend admin_rollback_handbook_chapters_publish: enrich audit metadata with policy snapshot
CREATE OR REPLACE FUNCTION public.admin_rollback_handbook_chapters_publish(
  p_package_id uuid, p_reason text DEFAULT 'manual_rollback', p_chapter_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid(); v_is_admin boolean := false;
  v_curriculum uuid; v_before integer := 0; v_unpublished integer := 0; v_after integer := 0;
  v_track text; v_chapter_count integer := 0; v_publishable integer := 0;
  v_blocker text; v_allowed boolean; v_required boolean;
  v_policy jsonb; v_result jsonb;
BEGIN
  IF v_caller IS NOT NULL THEN SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin; END IF;
  IF NOT v_is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_package_id IS NULL THEN RAISE EXCEPTION 'package_id required'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'reason required (>=5 chars)'; END IF;

  SELECT curriculum_id, track INTO v_curriculum, v_track
    FROM public.course_packages WHERE id = p_package_id;
  IF v_curriculum IS NULL THEN RAISE EXCEPTION 'package has no curriculum_id'; END IF;

  -- Snapshot policy context BEFORE mutation
  BEGIN
    v_policy := public.fn_handbook_publish_policy(v_track);
    v_allowed := COALESCE((v_policy->>'allowed')::boolean, true);
    v_required := COALESCE((v_policy->>'required')::boolean, false);
  EXCEPTION WHEN OTHERS THEN
    v_allowed := NULL; v_required := NULL; v_policy := NULL;
  END;

  SELECT COUNT(*) INTO v_chapter_count FROM public.handbook_chapters WHERE curriculum_id = v_curriculum;
  SELECT COUNT(*) INTO v_before        FROM public.handbook_chapters WHERE curriculum_id = v_curriculum AND is_published = true;

  -- publishable_count + blocker_reason from SSOT view (best-effort)
  BEGIN
    SELECT publishable_count, blocker_reason
      INTO v_publishable, v_blocker
      FROM public.v_handbook_publish_drift_alerts
     WHERE package_id = p_package_id;
  EXCEPTION WHEN OTHERS THEN
    v_publishable := NULL; v_blocker := NULL;
  END;
  v_publishable := COALESCE(v_publishable, 0);

  WITH upd AS (
    UPDATE public.handbook_chapters hc SET is_published = false, updated_at = now()
    WHERE hc.curriculum_id = v_curriculum AND hc.is_published = true
      AND (p_chapter_ids IS NULL OR hc.id = ANY(p_chapter_ids))
    RETURNING hc.id
  ) SELECT COUNT(*) INTO v_unpublished FROM upd;

  SELECT COUNT(*) INTO v_after FROM public.handbook_chapters
   WHERE curriculum_id = v_curriculum AND is_published = true;

  v_result := jsonb_build_object(
    'package_id',       p_package_id,
    'curriculum_id',    v_curriculum,
    'reason',           p_reason,
    'chapter_filter',   p_chapter_ids,
    'before_published', v_before,
    'unpublished',      v_unpublished,
    'after_published',  v_after,
    'chapter_count',    v_chapter_count,
    'publishable_count',v_publishable,
    'blocker_reason',   v_blocker,
    'track',            v_track,
    'allowed',          v_allowed,
    'required',         v_required,
    'policy',           v_policy,
    'caller',           v_caller,
    'ts',               now()
  );

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, metadata)
  VALUES ('handbook_publish_rollback', p_package_id, 'package',
          CASE WHEN v_unpublished > 0 THEN 'success' ELSE 'noop' END, v_result);
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_rollback_handbook_chapters_publish(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rollback_handbook_chapters_publish(uuid, text, uuid[]) TO authenticated, service_role;