-- =====================================================================
-- Funnel & Platform Integrity v2 — Cross-Domain Auto-Heal + Tracking-Härtung
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) track_conversion_event_v2: package_id Pflicht für strict events
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.track_conversion_event_v2(
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_anonymous_id text DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_page_path text DEFAULT NULL,
  p_curriculum_id uuid DEFAULT NULL,
  p_intent text DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL,
  p_package_id uuid DEFAULT NULL,
  p_persona text DEFAULT NULL,
  p_source_page text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_pkg uuid := p_package_id;
  v_meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_strict_events constant text[] := ARRAY[
    'quiz_started','quiz_completed','lead_capture_submitted','checkout_complete'
  ];
BEGIN
  IF p_event_type NOT IN (
    'hero_cta_click','pricing_view','checkout_start','checkout_complete',
    'lead_magnet_download','quiz_complete','optin_submit','doi_confirmed',
    'b2b_form_submit','course_open','exam_attempt',
    'page_view','add_to_cart',
    'lead_magnet_view','quiz_started','quiz_completed',
    'lead_capture_submitted','lernplan_viewed','bundle_cta_clicked',
    'quiz_cta_clicked',
    'quiz_start','lead_capture','lernplan_view'
  ) THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type;
  END IF;

  -- Backwards-compat: package_id may also arrive in metadata
  IF v_pkg IS NULL AND v_meta ? 'package_id' THEN
    BEGIN
      v_pkg := (v_meta->>'package_id')::uuid;
    EXCEPTION WHEN others THEN v_pkg := NULL;
    END;
  END IF;

  -- Strict validation: package_id required for mid/bottom funnel events
  IF p_event_type = ANY(v_strict_events) AND v_pkg IS NULL THEN
    RAISE EXCEPTION 'package_id required for event_type %', p_event_type
      USING ERRCODE = '22023', HINT = 'Pass p_package_id (uuid) or metadata.package_id';
  END IF;

  -- Merge package_id, persona, source_page into metadata (canonical position)
  v_meta := v_meta
    || CASE WHEN v_pkg IS NOT NULL THEN jsonb_build_object('package_id', v_pkg) ELSE '{}'::jsonb END
    || CASE WHEN p_persona IS NOT NULL THEN jsonb_build_object('persona', p_persona) ELSE '{}'::jsonb END
    || CASE WHEN p_source_page IS NOT NULL THEN jsonb_build_object('source_page', p_source_page) ELSE '{}'::jsonb END;

  INSERT INTO public.conversion_events(
    user_id, anonymous_id, session_id, page_path, event_type,
    metadata, curriculum_id, intent, contact_id
  ) VALUES (
    v_user, p_anonymous_id, p_session_id, p_page_path, p_event_type,
    v_meta, p_curriculum_id, p_intent, p_contact_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.track_conversion_event_v2(
  text, jsonb, text, text, text, uuid, text, uuid, uuid, text, text
) TO anon, authenticated;

COMMENT ON FUNCTION public.track_conversion_event_v2(
  text, jsonb, text, text, text, uuid, text, uuid, uuid, text, text
) IS 'SSOT funnel tracking. Strict events (quiz_*, lead_capture_submitted, checkout_complete) require package_id (param oder metadata).';

-- ─────────────────────────────────────────────────────────────────────
-- 2) SEO-Backfill: promote drafts + scaffold missing personas
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_seo_backfill_missing_pages(
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid,
  package_title text,
  persona_type text,
  action text,
  page_id uuid,
  slug text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pkg record;
  v_persona text;
  v_existing record;
  v_new_id uuid;
  v_slug text;
  v_personas constant text[] := ARRAY['azubi','betrieb','umschulung'];
  v_cert_slug text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.certification_id, c.slug AS cert_slug, c.title AS cert_title
    FROM public.course_packages cp
    LEFT JOIN public.certifications c ON c.id = cp.certification_id
    WHERE cp.status='published' AND cp.is_published=true
      AND NOT EXISTS (
        SELECT 1 FROM public.seo_content_pages s
        WHERE s.package_id = cp.id AND s.status='published'
      )
  LOOP
    v_cert_slug := COALESCE(v_pkg.cert_slug,
      regexp_replace(lower(v_pkg.title), '[^a-z0-9]+', '-', 'g'));

    FOREACH v_persona IN ARRAY v_personas LOOP
      package_id := v_pkg.id;
      package_title := v_pkg.title;
      persona_type := v_persona;
      v_slug := 'pruefungstraining/' || v_cert_slug || '/' || v_persona;

      SELECT s.id, s.status INTO v_existing
      FROM public.seo_content_pages s
      WHERE s.package_id = v_pkg.id AND s.persona_type = v_persona
      LIMIT 1;

      IF v_existing.id IS NOT NULL THEN
        -- already exists → promote draft to published
        IF v_existing.status = 'draft' THEN
          page_id := v_existing.id;
          slug := v_slug;
          action := 'promote_draft';
          IF NOT p_dry_run THEN
            UPDATE public.seo_content_pages
              SET status='published', updated_at=now()
              WHERE id = v_existing.id;
            INSERT INTO public.auto_heal_log(
              action_type, target_type, target_id, result_status, result_detail,
              trigger_source, metadata
            ) VALUES (
              'seo_backfill_promote', 'seo_content_page', v_existing.id,
              'success', format('Promoted %s/%s to published', v_pkg.title, v_persona),
              'admin_seo_backfill_missing_pages',
              jsonb_build_object('package_id', v_pkg.id, 'persona', v_persona, 'slug', v_slug)
            );
          END IF;
        ELSE
          action := 'already_published';
          page_id := v_existing.id;
          slug := v_slug;
        END IF;
        RETURN NEXT;
      ELSE
        -- create scaffold + publish
        action := 'scaffold_create';
        slug := v_slug;
        IF NOT p_dry_run THEN
          INSERT INTO public.seo_content_pages(
            package_id, curriculum_id, page_type, persona_type, slug,
            title, meta_description, content_md, status
          ) VALUES (
            v_pkg.id, NULL, 'persona_landing', v_persona, v_slug,
            format('%s · Prüfungstraining für %s', v_pkg.title,
              CASE v_persona
                WHEN 'azubi' THEN 'Auszubildende'
                WHEN 'betrieb' THEN 'Ausbildungsbetriebe'
                WHEN 'umschulung' THEN 'Umschüler:innen'
                ELSE v_persona
              END),
            format('%s — gezielt auf die IHK-Abschlussprüfung vorbereiten. Realistische Aufgaben, Lernpfade und KI-Tutor.', v_pkg.title),
            format(E'# %s\n\nGezielte Vorbereitung auf die Abschlussprüfung %s — passgenau für %s.\n\nDieser Lernpfad wird automatisch generiert. Inhalte folgen.',
              v_pkg.title, v_pkg.title, v_persona),
            'published'
          ) RETURNING id INTO v_new_id;
          page_id := v_new_id;
          INSERT INTO public.auto_heal_log(
            action_type, target_type, target_id, result_status, result_detail,
            trigger_source, metadata
          ) VALUES (
            'seo_backfill_scaffold', 'seo_content_page', v_new_id,
            'success', format('Scaffolded %s/%s', v_pkg.title, v_persona),
            'admin_seo_backfill_missing_pages',
            jsonb_build_object('package_id', v_pkg.id, 'persona', v_persona, 'slug', v_slug)
          );
        END IF;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_seo_backfill_missing_pages(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_seo_backfill_missing_pages(boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Cross-Domain Auto-Heal: pricing + seo
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_platform_auto_heal(
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pricing_high jsonb := '[]'::jsonb;
  v_pricing_low  jsonb := '[]'::jsonb;
  v_seo          jsonb := '[]'::jsonb;
  v_pricing_count int := 0;
  v_seo_count int := 0;
  v_summary jsonb;
BEGIN
  -- Pricing high confidence
  SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), COUNT(*)
    INTO v_pricing_high, v_pricing_count
  FROM public.admin_pricing_backfill_apply(
    p_dry_run := p_dry_run,
    p_confidence := ARRAY['high'],
    p_actions := ARRAY['create_price_only'],
    p_tiers := NULL
  ) t WHERE t.applied = true OR (p_dry_run AND t.would_create_price);

  -- Pricing low confidence (nur ihk_ausbildung_standard, semantisch korrigiert)
  SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), v_pricing_count + COUNT(*)
    INTO v_pricing_low, v_pricing_count
  FROM public.admin_pricing_backfill_apply(
    p_dry_run := p_dry_run,
    p_confidence := ARRAY['low'],
    p_actions := ARRAY['create_price_only'],
    p_tiers := ARRAY['ihk_ausbildung_standard']
  ) t WHERE t.applied = true OR (p_dry_run AND t.would_create_price);

  -- SEO backfill
  SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), COUNT(*)
    INTO v_seo, v_seo_count
  FROM public.admin_seo_backfill_missing_pages(p_dry_run := p_dry_run) t
  WHERE t.action IN ('promote_draft','scaffold_create');

  v_summary := jsonb_build_object(
    'dry_run', p_dry_run,
    'pricing_changes', v_pricing_count,
    'seo_changes', v_seo_count,
    'pricing_high', v_pricing_high,
    'pricing_low', v_pricing_low,
    'seo', v_seo,
    'ran_at', now()
  );

  IF NOT p_dry_run AND (v_pricing_count > 0 OR v_seo_count > 0) THEN
    INSERT INTO public.auto_heal_log(
      action_type, target_type, target_id, result_status, result_detail,
      trigger_source, metadata
    ) VALUES (
      'platform_auto_heal_run', 'system', gen_random_uuid(),
      'success',
      format('pricing=%s seo=%s', v_pricing_count, v_seo_count),
      'fn_platform_auto_heal',
      v_summary
    );
  END IF;

  RETURN v_summary;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_platform_auto_heal(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_platform_auto_heal(boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_platform_auto_heal(boolean) IS
'Cross-domain auto-heal: heals pricing drift (high+low/ihk_ausbildung_standard) and SEO drift (promote drafts + scaffold missing personas). Safe to run idempotently.';

-- ─────────────────────────────────────────────────────────────────────
-- 4) pg_cron: täglich 04:03 UTC
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('platform-auto-heal-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='platform-auto-heal-daily');
    PERFORM cron.schedule(
      'platform-auto-heal-daily',
      '3 4 * * *',
      $cmd$ SELECT public.fn_platform_auto_heal(false); $cmd$
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;