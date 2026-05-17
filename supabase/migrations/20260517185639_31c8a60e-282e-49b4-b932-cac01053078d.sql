DO $$
DECLARE
  v_correlation uuid := gen_random_uuid();
  v_phase text := 'e3d_1b_meta_description_backfill_v2_regex';
  v_trigger text := 'e3d_recon_runner';
  v_candidates int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  r record;
  v_derived text;
BEGIN
  CREATE TEMP TABLE tmp_meta_candidates ON COMMIT DROP AS
  SELECT v.blog_id AS id, v.doc_type, v.slug
  FROM public.v_blog_publish_readiness v
  WHERE v.decision = 'MISSING_SEO_META'
    AND 'missing_meta_description' = ANY(v.reasons);

  SELECT count(*) INTO v_candidates FROM tmp_meta_candidates;

  FOR r IN SELECT c.id, c.doc_type, c.slug, d.content_md
           FROM tmp_meta_candidates c
           JOIN public.seo_documents d ON d.id = c.id
  LOOP
    v_derived := nullif(trim((regexp_match(r.content_md, '"meta_description"\s*:\s*"((?:[^"\\]|\\.)*)"'))[1]), '');

    IF v_derived IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Unescape \" → "
    v_derived := replace(v_derived, '\"', '"');

    IF length(v_derived) > 160 THEN
      v_derived := substring(v_derived from 1 for 157) || '...';
    END IF;

    UPDATE public.seo_documents
    SET meta_description = v_derived, updated_at = now()
    WHERE id = r.id AND (meta_description IS NULL OR meta_description = '');

    IF FOUND THEN
      v_updated := v_updated + 1;
      PERFORM public.fn_emit_audit(
        'blog_publish_meta_description_repair_applied',
        'seo_document', r.id::text, 'success',
        jsonb_build_object(
          'phase', v_phase,
          'correlation_id', v_correlation,
          'doc_id', r.id, 'doc_type', r.doc_type, 'slug', r.slug,
          'source', 'content_md.regex_meta_description', 'length', length(v_derived)
        ),
        v_trigger, NULL
      );
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'blog_publish_meta_description_repair_summary',
    'seo_document', NULL, 'success',
    jsonb_build_object(
      'phase', v_phase,
      'correlation_id', v_correlation,
      'candidates', v_candidates, 'updated', v_updated, 'skipped', v_skipped
    ),
    v_trigger, NULL
  );
END $$;