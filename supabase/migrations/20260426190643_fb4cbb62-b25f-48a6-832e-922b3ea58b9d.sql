-- ============================================================
-- 1) AUTO-PUBLISH SEO PAGES BEIM PAKET-PUBLISH
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_auto_publish_seo_pages_on_package_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- Nur wenn jetzt veröffentlicht und vorher nicht
  IF NEW.is_published = true
     AND NEW.status = 'published'
     AND (
       OLD.is_published IS DISTINCT FROM NEW.is_published
       OR OLD.status IS DISTINCT FROM NEW.status
     ) THEN

    UPDATE public.seo_content_pages
    SET status = 'published',
        updated_at = now()
    WHERE package_id = NEW.id
      AND status = 'draft';

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'seo_pages_auto_publish',
        'fn_auto_publish_seo_pages_on_package_publish',
        'package', NEW.id::text, 'applied',
        format('Auto-published %s SEO pages', v_count),
        jsonb_build_object('package_id', NEW.id, 'pages_published', v_count)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_publish_seo_pages ON public.course_packages;
CREATE TRIGGER trg_auto_publish_seo_pages
  AFTER UPDATE ON public.course_packages
  FOR EACH ROW
  WHEN (NEW.is_published IS DISTINCT FROM OLD.is_published OR NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.fn_auto_publish_seo_pages_on_package_publish();

-- ============================================================
-- 2) BACKFILL: bestehende Drafts zu published-Paketen sofort live
-- ============================================================
WITH publishable AS (
  SELECT scp.id
  FROM public.seo_content_pages scp
  JOIN public.course_packages cp ON cp.id = scp.package_id
  WHERE scp.status = 'draft'
    AND cp.is_published = true
    AND cp.status = 'published'
),
upd AS (
  UPDATE public.seo_content_pages scp
  SET status = 'published', updated_at = now()
  FROM publishable p
  WHERE scp.id = p.id
  RETURNING scp.id
)
INSERT INTO public.auto_heal_log(
  action_type, trigger_source, target_type, result_status, result_detail, metadata
)
SELECT 'seo_pages_backfill_publish','manual_backfill_2026_04_26','seo_content_pages',
       'applied',
       format('Backfilled %s draft pages to published', count(*)),
       jsonb_build_object('count', count(*))
FROM upd
HAVING count(*) > 0;

-- ============================================================
-- 3) FUNNEL-EVENTS ERWEITERN (page_view + add_to_cart)
-- ============================================================
CREATE OR REPLACE FUNCTION public.track_conversion_event_v2(
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_anonymous_id text DEFAULT NULL::text,
  p_session_id text DEFAULT NULL::text,
  p_page_path text DEFAULT NULL::text,
  p_curriculum_id uuid DEFAULT NULL::uuid,
  p_intent text DEFAULT NULL::text,
  p_contact_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_user uuid := auth.uid();
BEGIN
  IF p_event_type NOT IN (
    'hero_cta_click','pricing_view','checkout_start','checkout_complete',
    'lead_magnet_download','quiz_complete','optin_submit','doi_confirmed',
    'b2b_form_submit','course_open','exam_attempt',
    -- ── NEU: Funnel-Tiefen-Events ──
    'page_view','add_to_cart'
  ) THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type;
  END IF;

  INSERT INTO public.conversion_events(
    user_id, anonymous_id, session_id, page_path, event_type,
    metadata, curriculum_id, intent, contact_id
  ) VALUES (
    v_user, p_anonymous_id, p_session_id, p_page_path, p_event_type,
    COALESCE(p_metadata,'{}'::jsonb), p_curriculum_id, p_intent, p_contact_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;