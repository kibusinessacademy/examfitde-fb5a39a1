
-- SEO Eligibility Hardening v1 — Triggers + Backfill
-- Column, RPC pre-flight, and thin-guard hard-blocker already applied.
-- This migration adds the sync triggers and runs the backfill.

-- 1) Sync function: set package_publish_eligible from course_packages.status
CREATE OR REPLACE FUNCTION public.fn_seo_queue_set_pkg_eligible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_eligible boolean := false;
BEGIN
  IF NEW.curriculum_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.course_packages cp
      WHERE cp.curriculum_id = NEW.curriculum_id
        AND cp.status::text = 'published'
    ) INTO v_eligible;
  END IF;
  NEW.package_publish_eligible := v_eligible;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seo_queue_set_pkg_eligible ON public.seo_content_priority_queue;
CREATE TRIGGER trg_seo_queue_set_pkg_eligible
BEFORE INSERT OR UPDATE OF curriculum_id ON public.seo_content_priority_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_seo_queue_set_pkg_eligible();

-- 2) Refresh function: when a course_packages.status changes, refresh queue rows
CREATE OR REPLACE FUNCTION public.fn_seo_queue_refresh_on_package_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_eligible boolean;
  v_updated int := 0;
BEGIN
  IF (TG_OP = 'UPDATE' AND NEW.status::text IS NOT DISTINCT FROM OLD.status::text
      AND NEW.curriculum_id IS NOT DISTINCT FROM OLD.curriculum_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.course_packages cp
    WHERE cp.curriculum_id = NEW.curriculum_id
      AND cp.status::text = 'published'
  ) INTO v_new_eligible;

  UPDATE public.seo_content_priority_queue q
     SET package_publish_eligible = v_new_eligible,
         updated_at = now()
   WHERE q.curriculum_id = NEW.curriculum_id
     AND q.package_publish_eligible IS DISTINCT FROM v_new_eligible;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'seo_queue_eligibility_refresh',
      'curriculum',
      NEW.curriculum_id,
      'success',
      jsonb_build_object(
        'package_id', NEW.id,
        'new_status', NEW.status,
        'new_eligible', v_new_eligible,
        'rows_updated', v_updated
      )
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seo_queue_refresh_on_package_status ON public.course_packages;
CREATE TRIGGER trg_seo_queue_refresh_on_package_status
AFTER INSERT OR UPDATE OF status, curriculum_id ON public.course_packages
FOR EACH ROW EXECUTE FUNCTION public.fn_seo_queue_refresh_on_package_status();

-- 3) Backfill existing rows
DO $$
DECLARE
  v_updated int;
  v_now_eligible int;
  v_now_blocked int;
BEGIN
  UPDATE public.seo_content_priority_queue q
     SET package_publish_eligible = EXISTS (
           SELECT 1 FROM public.course_packages cp
           WHERE cp.curriculum_id = q.curriculum_id
             AND cp.status::text = 'published'
         ),
         updated_at = now()
   WHERE q.curriculum_id IS NOT NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT count(*) FILTER (WHERE package_publish_eligible),
         count(*) FILTER (WHERE NOT package_publish_eligible)
    INTO v_now_eligible, v_now_blocked
    FROM public.seo_content_priority_queue;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'seo_queue_eligibility_backfill',
    'system',
    'success',
    jsonb_build_object(
      'rows_recomputed', v_updated,
      'eligible_now', v_now_eligible,
      'blocked_now', v_now_blocked,
      'migration', 'seo_eligibility_hardening_v1_triggers'
    )
  );
END $$;
