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
  IF v_caller IS NOT NULL THEN
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  END IF;
  IF NOT v_is_admin AND current_setting('role', true) <> 'service_role'
     AND NOT (current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

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

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, metadata)
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
      INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, metadata)
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