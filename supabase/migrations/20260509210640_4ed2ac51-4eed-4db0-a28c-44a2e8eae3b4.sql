-- ============================================================================
-- Handbook Publish Backfill + Pipeline Hook
-- ============================================================================

-- 1) Eligibility helper
CREATE OR REPLACE FUNCTION public.fn_handbook_chapter_publishable(p_chapter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ch AS (
    SELECT hc.id, hc.title, hc.curriculum_id
    FROM public.handbook_chapters hc
    WHERE hc.id = p_chapter_id
  ),
  pkg AS (
    SELECT cp.id AS package_id, cp.status, cp.feature_flags
    FROM public.course_packages cp
    WHERE cp.curriculum_id = (SELECT curriculum_id FROM ch)
    ORDER BY (cp.status='published') DESC, cp.created_at DESC NULLS LAST
    LIMIT 1
  ),
  steps AS (
    SELECT
      bool_or(step_key='generate_handbook' AND status='done') AS gen_done,
      bool_or(step_key='validate_handbook' AND status='done') AS val_done
    FROM public.package_steps
    WHERE package_id = (SELECT package_id FROM pkg)
  ),
  sect AS (
    SELECT COUNT(*) AS c
    FROM public.handbook_sections hs
    WHERE hs.chapter_id = p_chapter_id
      AND COALESCE(NULLIF(trim(hs.basis_content), ''), NULLIF(trim(hs.content_markdown), '')) IS NOT NULL
  )
  SELECT
    (SELECT title IS NOT NULL AND length(trim(title)) > 0 FROM ch)
    AND (SELECT status IN ('published','done') FROM pkg)
    AND COALESCE((SELECT gen_done FROM steps), false)
    AND COALESCE((SELECT val_done FROM steps), false)
    AND (SELECT c FROM sect) > 0
    AND NOT COALESCE(((SELECT feature_flags FROM pkg)->>'handbook_quality_block')::boolean, false)
$$;

REVOKE ALL ON FUNCTION public.fn_handbook_chapter_publishable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_handbook_chapter_publishable(uuid) TO service_role;

-- 2) Drift view (per package)
CREATE OR REPLACE VIEW public.v_handbook_publish_drift AS
WITH pkg_chapters AS (
  SELECT
    cp.id AS package_id,
    cp.curriculum_id,
    cp.title AS package_title,
    cp.status AS package_status,
    cp.feature_flags,
    hc.id AS chapter_id,
    hc.is_published,
    hc.title AS chapter_title,
    EXISTS (
      SELECT 1 FROM public.handbook_sections hs
      WHERE hs.chapter_id = hc.id
        AND COALESCE(NULLIF(trim(hs.basis_content), ''), NULLIF(trim(hs.content_markdown), '')) IS NOT NULL
    ) AS has_content
  FROM public.course_packages cp
  LEFT JOIN public.handbook_chapters hc ON hc.curriculum_id = cp.curriculum_id
),
steps_agg AS (
  SELECT
    package_id,
    bool_or(step_key='generate_handbook' AND status='done') AS gen_done,
    bool_or(step_key='validate_handbook' AND status='done') AS val_done
  FROM public.package_steps
  WHERE step_key IN ('generate_handbook','validate_handbook')
  GROUP BY package_id
)
SELECT
  pc.package_id,
  pc.curriculum_id,
  pc.package_title,
  pc.package_status,
  COUNT(pc.chapter_id)                                  AS chapter_count,
  COUNT(*) FILTER (WHERE pc.is_published)               AS published_count,
  COUNT(*) FILTER (
    WHERE pc.chapter_title IS NOT NULL
      AND length(trim(pc.chapter_title)) > 0
      AND pc.has_content
      AND pc.package_status IN ('published','done')
      AND COALESCE(sa.gen_done, false)
      AND COALESCE(sa.val_done, false)
      AND NOT COALESCE((pc.feature_flags->>'handbook_quality_block')::boolean, false)
  )                                                     AS publishable_count,
  CASE
    WHEN pc.package_status NOT IN ('published','done') THEN 'PACKAGE_NOT_PUBLISHED'
    WHEN NOT COALESCE(bool_and(sa.gen_done), false)    THEN 'GENERATE_NOT_DONE'
    WHEN NOT COALESCE(bool_and(sa.val_done), false)    THEN 'VALIDATE_NOT_DONE'
    WHEN COUNT(pc.chapter_id) = 0                       THEN 'NO_CHAPTERS'
    WHEN COALESCE((pc.feature_flags->>'handbook_quality_block')::boolean, false) THEN 'QUALITY_BLOCK'
    WHEN COUNT(*) FILTER (WHERE pc.is_published) = 0    THEN 'DRIFT_NONE_PUBLISHED'
    WHEN COUNT(*) FILTER (WHERE pc.is_published) < COUNT(pc.chapter_id) THEN 'PARTIAL_PUBLISHED'
    ELSE 'OK'
  END AS blocker_reason
FROM pkg_chapters pc
LEFT JOIN steps_agg sa ON sa.package_id = pc.package_id
GROUP BY pc.package_id, pc.curriculum_id, pc.package_title, pc.package_status, pc.feature_flags;

REVOKE ALL ON public.v_handbook_publish_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_handbook_publish_drift TO service_role;

-- Drift alerts (only published packages with publishable but unpublished chapters)
CREATE OR REPLACE VIEW public.v_handbook_publish_drift_alerts AS
SELECT *
FROM public.v_handbook_publish_drift
WHERE package_status IN ('published','done')
  AND publishable_count > published_count;

REVOKE ALL ON public.v_handbook_publish_drift_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_handbook_publish_drift_alerts TO service_role;

-- 3) Backfill RPC
CREATE OR REPLACE FUNCTION public.admin_backfill_publishable_handbook_chapters(
  p_dry_run boolean DEFAULT true,
  p_package_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_before_published integer := 0;
  v_publishable integer := 0;
  v_updated integer := 0;
  v_after_published integer := 0;
  v_packages_affected integer := 0;
  v_result jsonb;
BEGIN
  -- Auth: admin OR service_role
  IF v_caller IS NOT NULL THEN
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  END IF;
  IF NOT v_is_admin AND current_setting('role', true) <> 'service_role'
     AND NOT (current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Snapshot
  SELECT
    COALESCE(SUM(published_count), 0),
    COALESCE(SUM(publishable_count), 0)
  INTO v_before_published, v_publishable
  FROM public.v_handbook_publish_drift
  WHERE (p_package_id IS NULL OR package_id = p_package_id);

  IF NOT p_dry_run THEN
    WITH eligible AS (
      SELECT hc.id
      FROM public.handbook_chapters hc
      JOIN public.course_packages cp ON cp.curriculum_id = hc.curriculum_id
      WHERE COALESCE(hc.is_published, false) = false
        AND cp.status IN ('published','done')
        AND (p_package_id IS NULL OR cp.id = p_package_id)
        AND public.fn_handbook_chapter_publishable(hc.id) = true
    ), upd AS (
      UPDATE public.handbook_chapters hc
      SET is_published = true, updated_at = now()
      FROM eligible e
      WHERE hc.id = e.id
      RETURNING hc.id, hc.curriculum_id
    )
    SELECT COUNT(*), COUNT(DISTINCT curriculum_id) INTO v_updated, v_packages_affected FROM upd;

    SELECT COALESCE(SUM(published_count), 0)
    INTO v_after_published
    FROM public.v_handbook_publish_drift
    WHERE (p_package_id IS NULL OR package_id = p_package_id);
  ELSE
    v_updated := 0;
    v_after_published := v_before_published;
    SELECT COUNT(DISTINCT package_id)
    INTO v_packages_affected
    FROM public.v_handbook_publish_drift
    WHERE publishable_count > published_count
      AND (p_package_id IS NULL OR package_id = p_package_id);
  END IF;

  v_result := jsonb_build_object(
    'dry_run', p_dry_run,
    'package_filter', p_package_id,
    'before_published', v_before_published,
    'publishable_total', v_publishable,
    'updated', v_updated,
    'after_published', v_after_published,
    'packages_affected', v_packages_affected,
    'ts', now()
  );

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, meta)
  VALUES (
    'handbook_publish_backfill',
    p_package_id,
    CASE WHEN p_package_id IS NULL THEN 'system' ELSE 'package' END,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    v_result
  );

  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_publishable_handbook_chapters(boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_publishable_handbook_chapters(boolean, uuid) TO authenticated, service_role;

-- 4) Pipeline Hook: AFTER UPDATE on course_packages → publish eligible chapters
CREATE OR REPLACE FUNCTION public.fn_auto_publish_handbook_chapters_on_pkg_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NEW.status IN ('published','done')
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.curriculum_id IS NOT NULL THEN

    WITH upd AS (
      UPDATE public.handbook_chapters hc
      SET is_published = true, updated_at = now()
      WHERE hc.curriculum_id = NEW.curriculum_id
        AND COALESCE(hc.is_published, false) = false
        AND public.fn_handbook_chapter_publishable(hc.id) = true
      RETURNING hc.id
    )
    SELECT COUNT(*) INTO v_count FROM upd;

    IF v_count > 0 THEN
      INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, meta)
      VALUES (
        'handbook_auto_publish_on_pkg_publish',
        NEW.id,
        'package',
        'success',
        jsonb_build_object(
          'package_id', NEW.id,
          'curriculum_id', NEW.curriculum_id,
          'chapters_published', v_count,
          'old_status', OLD.status,
          'new_status', NEW.status
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_handbook_chapters_auto_publish ON public.course_packages;
CREATE TRIGGER trg_handbook_chapters_auto_publish
AFTER UPDATE OF status ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.fn_auto_publish_handbook_chapters_on_pkg_publish();

-- 5) Summary RPC for Leitstelle UI
CREATE OR REPLACE FUNCTION public.admin_get_handbook_publish_drift_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_summary jsonb;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  END IF;
  IF NOT v_is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'drift_packages', COUNT(*),
    'chapters_publishable_pending', COALESCE(SUM(publishable_count - published_count), 0),
    'top_offenders', COALESCE((
      SELECT jsonb_agg(row)
      FROM (
        SELECT jsonb_build_object(
          'package_id', package_id,
          'package_title', package_title,
          'chapter_count', chapter_count,
          'published_count', published_count,
          'publishable_count', publishable_count,
          'blocker_reason', blocker_reason
        ) AS row
        FROM public.v_handbook_publish_drift_alerts
        ORDER BY (publishable_count - published_count) DESC
        LIMIT 25
      ) t
    ), '[]'::jsonb)
  )
  INTO v_summary
  FROM public.v_handbook_publish_drift_alerts;

  RETURN v_summary;
END
$$;

REVOKE ALL ON FUNCTION public.admin_get_handbook_publish_drift_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_handbook_publish_drift_summary() TO authenticated, service_role;