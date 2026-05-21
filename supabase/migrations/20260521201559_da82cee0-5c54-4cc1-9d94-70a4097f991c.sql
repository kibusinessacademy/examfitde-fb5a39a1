
CREATE OR REPLACE FUNCTION public.fn_seo_pillar_ensure_skeleton(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pkg RECORD;
  v_beruf_slug text;
  v_created int := 0;
  v_skipped int := 0;
  v_intent text;
  v_slug text;
  v_title text;
  v_was_insert boolean;
BEGIN
  SELECT id, title, package_key, status, certification_id
    INTO v_pkg
  FROM public.course_packages WHERE id = _package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','reason','PACKAGE_NOT_FOUND');
  END IF;
  IF v_pkg.status <> 'published' THEN
    RETURN jsonb_build_object('status','skipped','reason','PACKAGE_NOT_PUBLISHED');
  END IF;

  v_beruf_slug := regexp_replace(
    lower(translate(COALESCE(v_pkg.package_key, v_pkg.title), 'äöüÄÖÜß', 'aouAOUs')),
    '[^a-z0-9]+', '-', 'g'
  );
  v_beruf_slug := regexp_replace(v_beruf_slug, '(^-|-$)', '', 'g');

  FOR v_intent IN SELECT unnest(ARRAY['pruefungsfragen','pruefungsvorbereitung']) LOOP
    v_slug := v_intent || '-' || v_beruf_slug || '-pillar-guide';
    v_title := CASE v_intent
      WHEN 'pruefungsfragen' THEN 'Prüfungsfragen ' || v_pkg.title || ' — Pillar Guide'
      ELSE 'Prüfungsvorbereitung ' || v_pkg.title || ' — Pillar Guide'
    END;

    INSERT INTO public.blog_articles (
      slug, title, status, source_package_id, article_type, target_keyword, content_md, meta_description
    )
    VALUES (
      v_slug,
      v_title,
      'reserved',
      _package_id,
      'pillar_guide',
      v_intent || ' ' || v_pkg.title,
      '<!-- SKELETON: awaiting governance approval. Sections: intro, USP, FAQ-slots, CTA-slot, internal links. -->',
      left(v_title, 155)
    )
    ON CONFLICT (slug) DO UPDATE
      SET source_package_id = COALESCE(public.blog_articles.source_package_id, EXCLUDED.source_package_id)
    RETURNING (xmax = 0) INTO v_was_insert;

    IF v_was_insert THEN v_created := v_created + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'seo_pillar_skeleton_ensured',
    jsonb_build_object('package_id', _package_id, 'created', v_created, 'skipped', v_skipped, 'beruf_slug', v_beruf_slug)
  );
  RETURN jsonb_build_object('status','ok','created',v_created,'skipped',v_skipped,'beruf_slug',v_beruf_slug);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','error','reason',SQLERRM);
END $fn$;
