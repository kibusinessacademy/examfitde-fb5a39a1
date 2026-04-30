CREATE OR REPLACE FUNCTION public.fn_platform_auto_heal(
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pricing jsonb := '[]'::jsonb;
  v_seo     jsonb := '[]'::jsonb;
  v_pricing_count int := 0;
  v_seo_count int := 0;
  v_rec record;
  v_new_price_id uuid;
  v_new_page_id uuid;
  v_pkg record;
  v_persona text;
  v_existing record;
  v_slug text;
  v_cert_slug text;
  v_personas constant text[] := ARRAY['azubi','betrieb','umschulung'];
  v_summary jsonb;
  v_pricing_arr jsonb := '[]'::jsonb;
  v_seo_arr jsonb := '[]'::jsonb;
BEGIN
  -- ── Pricing: high+low/ihk_ausbildung_standard, action=create_price_only ──
  FOR v_rec IN
    SELECT v.*
    FROM public.v_pricing_backfill_dryrun v
    WHERE v.action_needed = 'create_price_only'
      AND v.existing_product_id IS NOT NULL
      AND v.suggested_price_cents IS NOT NULL
      AND (
        v.confidence = 'high'
        OR (v.confidence = 'low' AND v.suggested_tier = 'ihk_ausbildung_standard')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.product_prices pp
        WHERE pp.product_id = v.existing_product_id AND pp.active = true
      )
  LOOP
    IF p_dry_run THEN
      v_pricing_arr := v_pricing_arr || jsonb_build_object(
        'package_id', v_rec.package_id,
        'package_title', v_rec.package_title,
        'tier', v_rec.suggested_tier,
        'cents', v_rec.suggested_price_cents,
        'applied', false,
        'dry_run', true
      );
      v_pricing_count := v_pricing_count + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.product_prices(
      product_id, currency, amount_cents, billing_type, access_months, active
    ) VALUES (
      v_rec.existing_product_id, 'eur', v_rec.suggested_price_cents, 'one_time', 12, true
    ) RETURNING id INTO v_new_price_id;

    INSERT INTO public.auto_heal_log(
      action_type, target_type, target_id, result_status, result_detail,
      trigger_source, metadata
    ) VALUES (
      'pricing_backfill_create_price', 'product', v_rec.existing_product_id,
      'success',
      format('Created price %s cents (tier=%s, confidence=%s)',
        v_rec.suggested_price_cents, v_rec.suggested_tier, v_rec.confidence),
      'fn_platform_auto_heal',
      jsonb_build_object(
        'package_id', v_rec.package_id,
        'package_title', v_rec.package_title,
        'price_id', v_new_price_id,
        'tier', v_rec.suggested_tier,
        'amount_cents', v_rec.suggested_price_cents,
        'confidence', v_rec.confidence
      )
    );

    v_pricing_arr := v_pricing_arr || jsonb_build_object(
      'package_id', v_rec.package_id,
      'package_title', v_rec.package_title,
      'tier', v_rec.suggested_tier,
      'cents', v_rec.suggested_price_cents,
      'price_id', v_new_price_id,
      'applied', true
    );
    v_pricing_count := v_pricing_count + 1;
  END LOOP;

  -- ── SEO: promote drafts + scaffold missing personas ──
  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.certification_id, c.slug AS cert_slug
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
      v_slug := 'pruefungstraining/' || v_cert_slug || '/' || v_persona;

      SELECT s.id, s.status INTO v_existing
      FROM public.seo_content_pages s
      WHERE s.package_id = v_pkg.id AND s.persona_type = v_persona
      LIMIT 1;

      IF v_existing.id IS NOT NULL THEN
        IF v_existing.status = 'draft' THEN
          IF NOT p_dry_run THEN
            UPDATE public.seo_content_pages
              SET status='published', updated_at=now()
              WHERE id = v_existing.id;
            INSERT INTO public.auto_heal_log(
              action_type, target_type, target_id, result_status, result_detail,
              trigger_source, metadata
            ) VALUES (
              'seo_backfill_promote', 'seo_content_page', v_existing.id,
              'success', format('Promoted %s/%s', v_pkg.title, v_persona),
              'fn_platform_auto_heal',
              jsonb_build_object('package_id', v_pkg.id, 'persona', v_persona, 'slug', v_slug)
            );
          END IF;
          v_seo_arr := v_seo_arr || jsonb_build_object(
            'package_id', v_pkg.id, 'persona', v_persona, 'action','promote_draft',
            'page_id', v_existing.id, 'slug', v_slug, 'applied', NOT p_dry_run
          );
          v_seo_count := v_seo_count + 1;
        END IF;
      ELSE
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
                ELSE v_persona END),
            format('%s — gezielt auf die IHK-Abschlussprüfung vorbereiten. Realistische Aufgaben, Lernpfade und KI-Tutor.', v_pkg.title),
            format(E'# %s\n\nGezielte Vorbereitung auf die Abschlussprüfung %s — passgenau für %s.\n\nDieser Lernpfad wird automatisch generiert. Inhalte folgen.',
              v_pkg.title, v_pkg.title, v_persona),
            'published'
          ) RETURNING id INTO v_new_page_id;
          INSERT INTO public.auto_heal_log(
            action_type, target_type, target_id, result_status, result_detail,
            trigger_source, metadata
          ) VALUES (
            'seo_backfill_scaffold', 'seo_content_page', v_new_page_id,
            'success', format('Scaffolded %s/%s', v_pkg.title, v_persona),
            'fn_platform_auto_heal',
            jsonb_build_object('package_id', v_pkg.id, 'persona', v_persona, 'slug', v_slug)
          );
        END IF;
        v_seo_arr := v_seo_arr || jsonb_build_object(
          'package_id', v_pkg.id, 'persona', v_persona, 'action','scaffold_create',
          'page_id', v_new_page_id, 'slug', v_slug, 'applied', NOT p_dry_run
        );
        v_seo_count := v_seo_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  v_summary := jsonb_build_object(
    'dry_run', p_dry_run,
    'pricing_changes', v_pricing_count,
    'seo_changes', v_seo_count,
    'pricing', v_pricing_arr,
    'seo', v_seo_arr,
    'ran_at', now()
  );

  IF NOT p_dry_run AND (v_pricing_count > 0 OR v_seo_count > 0) THEN
    INSERT INTO public.auto_heal_log(
      action_type, target_type, target_id, result_status, result_detail,
      trigger_source, metadata
    ) VALUES (
      'platform_auto_heal_run', 'system', gen_random_uuid(),
      'success', format('pricing=%s seo=%s', v_pricing_count, v_seo_count),
      'fn_platform_auto_heal', v_summary
    );
  END IF;

  RETURN v_summary;
END;
$function$;