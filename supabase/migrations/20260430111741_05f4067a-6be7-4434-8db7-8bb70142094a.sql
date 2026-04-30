
DO $$
DECLARE
  v_match_count int;
  v_ambiguous_count int;
  v_unmatched_count int;
  v_already_linked int;
  v_updated_count int;
BEGIN
  SELECT
    count(*) FILTER (WHERE cc.linked_certification_id IS NULL
                     AND (SELECT count(*) FROM public.certifications c WHERE c.slug = cc.slug) = 1),
    count(*) FILTER (WHERE cc.linked_certification_id IS NULL
                     AND (SELECT count(*) FROM public.certifications c WHERE c.slug = cc.slug) > 1),
    count(*) FILTER (WHERE cc.linked_certification_id IS NULL
                     AND (SELECT count(*) FROM public.certifications c WHERE c.slug = cc.slug) = 0),
    count(*) FILTER (WHERE cc.linked_certification_id IS NOT NULL)
    INTO v_match_count, v_ambiguous_count, v_unmatched_count, v_already_linked
  FROM public.certification_catalog cc;

  WITH upd AS (
    UPDATE public.certification_catalog cc
       SET linked_certification_id = c.id
      FROM public.certifications c
     WHERE cc.linked_certification_id IS NULL
       AND cc.slug = c.slug
       AND (SELECT count(*) FROM public.certifications c2 WHERE c2.slug = cc.slug) = 1
    RETURNING cc.id
  )
  SELECT count(*) INTO v_updated_count FROM upd;

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_type, result_status, metadata)
  VALUES (
    'manual_admin',
    'backfill_catalog_linked_cert_v1',
    'certification_catalog',
    'success',
    jsonb_build_object(
      'pre_match_count', v_match_count,
      'pre_ambiguous_count', v_ambiguous_count,
      'pre_unmatched_count', v_unmatched_count,
      'pre_already_linked', v_already_linked,
      'updated_count', v_updated_count,
      'skipped_ambiguous', v_ambiguous_count,
      'skipped_unmatched', v_unmatched_count,
      'executed_at', now()
    )
  );

  RAISE NOTICE 'Backfill: updated=%, skipped_ambiguous=%, skipped_unmatched=%',
    v_updated_count, v_ambiguous_count, v_unmatched_count;
END$$;
