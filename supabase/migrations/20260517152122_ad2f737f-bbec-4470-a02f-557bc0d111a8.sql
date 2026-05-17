DO $$
DECLARE
  v_cap int := 75;
  v_attempted int := 0;
  v_published int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_rec record;
  v_started timestamptz := now();
  v_reason text := 'E3f publish-gate wave2 promote 75 ready pillars to live';
BEGIN
  FOR v_rec IN
    SELECT * FROM public.v_pillar_publish_readiness
    WHERE decision = 'READY_TO_PUBLISH'
    ORDER BY catalog_slug NULLS LAST
    LIMIT v_cap
  LOOP
    v_attempted := v_attempted + 1;
    BEGIN
      UPDATE public.certification_seo_pages
         SET is_published = true,
             published_at = COALESCE(published_at, now()),
             updated_at   = now()
       WHERE id = v_rec.pillar_id
         AND is_published IS NOT TRUE;
      IF FOUND THEN
        v_published := v_published + 1;
        PERFORM public.fn_emit_audit(
          'pillar_publish_attempt','certification_seo_pages', v_rec.pillar_id::text,'success',
          jsonb_build_object('pillar_id', v_rec.pillar_id,'catalog_id', v_rec.catalog_id,
            'package_id', v_rec.package_id,'dry_run', false,'reason', v_reason,
            'quality_score', v_rec.quality_score,'outbound_links', v_rec.outbound_links,
            'wave','wave2'),
          'admin_publish_certification_pillars');
      ELSE
        v_skipped := v_skipped + 1;
        PERFORM public.fn_emit_audit(
          'pillar_publish_skipped','certification_seo_pages', v_rec.pillar_id::text,'skipped',
          jsonb_build_object('pillar_id', v_rec.pillar_id,'catalog_id', v_rec.catalog_id,
            'skip_reason','ALREADY_PUBLISHED_OR_NOOP','dry_run', false,'wave','wave2'),
          'admin_publish_certification_pillars');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      BEGIN
        PERFORM public.fn_emit_audit(
          'pillar_publish_skipped','certification_seo_pages', v_rec.pillar_id::text,'error',
          jsonb_build_object('pillar_id', v_rec.pillar_id,'skip_reason','EXCEPTION',
            'error', SQLERRM,'wave','wave2'),
          'admin_publish_certification_pillars', SQLERRM);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'pillar_publish_summary','system', NULL,
    CASE WHEN v_failed=0 THEN 'success' ELSE 'partial' END,
    jsonb_build_object('ran_at', v_started, 'dry_run', false, 'reason', v_reason,
      'limit', v_cap, 'attempted', v_attempted,
      'published', v_published, 'skipped', v_skipped, 'failed', v_failed,
      'wave','wave2'),
    'admin_publish_certification_pillars');

  RAISE NOTICE 'E3f Wave2: attempted=% published=% skipped=% failed=%',
    v_attempted, v_published, v_skipped, v_failed;
END $$;