INSERT INTO public.ops_audit_contract (action_type, owner_module, required_keys)
VALUES
  ('blog_publish_meta_description_repair_detected', 'seo_blog_publish', ARRAY['phase','candidates']),
  ('blog_publish_meta_description_repair_applied',  'seo_blog_publish', ARRAY['phase','doc_id','doc_type','slug','source','length']),
  ('blog_publish_meta_description_repair_summary',  'seo_blog_publish', ARRAY['phase','candidates','updated','skipped'])
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE
  v_correlation uuid := gen_random_uuid();
  v_phase text := 'e3d_1b_meta_description_backfill';
  v_trigger text := 'e3d_recon_runner';
  v_candidates int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  r record;
  v_derived text;
  v_source text;
BEGIN
  CREATE TEMP TABLE tmp_meta_candidates ON COMMIT DROP AS
  SELECT v.blog_id AS id, v.doc_type, v.slug
  FROM public.v_blog_publish_readiness v
  WHERE v.decision = 'MISSING_SEO_META'
    AND 'missing_meta_description' = ANY(v.reasons);

  SELECT count(*) INTO v_candidates FROM tmp_meta_candidates;

  PERFORM public.fn_emit_audit(
    'blog_publish_meta_description_repair_detected',
    'seo_document', NULL, 'detected',
    jsonb_build_object(
      'phase', v_phase,
      'correlation_id', v_correlation,
      'candidates', v_candidates,
      'ids', (SELECT coalesce(jsonb_agg(id), '[]'::jsonb) FROM tmp_meta_candidates)
    ),
    v_trigger, NULL
  );

  FOR r IN SELECT c.id, c.doc_type, c.slug, d.content_md
           FROM tmp_meta_candidates c
           JOIN public.seo_documents d ON d.id = c.id
  LOOP
    v_derived := NULL; v_source := NULL;
    BEGIN
      v_derived := nullif(trim(r.content_md::jsonb ->> 'meta_description'), '');
      IF v_derived IS NOT NULL THEN v_source := 'content_md.meta_description'; END IF;
    EXCEPTION WHEN others THEN v_derived := NULL;
    END;

    IF v_derived IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

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
          'source', v_source, 'length', length(v_derived)
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