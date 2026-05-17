
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('catalog_cert_link_backfill_detected',
   ARRAY['catalog_id','strategy','confidence']::text[], 'seo'),
  ('catalog_cert_link_backfill_applied',
   ARRAY['catalog_id','certification_id','strategy','confidence']::text[], 'seo'),
  ('catalog_cert_link_backfill_skipped_ambiguous',
   ARRAY['catalog_id','strategy','ambiguity_count']::text[], 'seo'),
  ('catalog_cert_link_backfill_summary',
   ARRAY['scanned','auto_applied','skipped_ambiguous','no_match','dry_run']::text[], 'seo')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_catalog_certification_link_candidates AS
WITH cat AS (
  SELECT cc.id AS catalog_id, cc.slug AS catalog_slug, cc.title AS catalog_title,
    cc.linked_certification_id,
    lower(cc.slug) AS norm_slug,
    lower(regexp_replace(cc.title,'[^a-z0-9]+','','gi')) AS norm_title
  FROM public.certification_catalog cc
),
cert AS (
  SELECT c.id, c.slug, c.title,
    lower(c.slug) AS norm_slug,
    lower(regexp_replace(c.title,'[^a-z0-9]+','','gi')) AS norm_title
  FROM public.certifications c
),
exact_slug AS (
  SELECT cat.catalog_id, cert.id AS certification_id
  FROM cat JOIN cert ON cat.norm_slug = cert.norm_slug
),
title_match AS (
  SELECT cat.catalog_id,
         (array_agg(cert.id ORDER BY cert.id))[1] AS certification_id,
         COUNT(*)::int AS ambiguity_count
  FROM cat JOIN cert ON cat.norm_title = cert.norm_title
  WHERE cat.catalog_id NOT IN (SELECT catalog_id FROM exact_slug)
  GROUP BY cat.catalog_id
),
classified AS (
  SELECT
    cat.catalog_id, cat.catalog_slug, cat.catalog_title,
    cat.linked_certification_id AS current_link,
    COALESCE(es.certification_id, tm.certification_id) AS candidate_certification_id,
    CASE
      WHEN es.certification_id IS NOT NULL THEN 'exact_slug'
      WHEN tm.ambiguity_count = 1 THEN 'normalized_title_unique'
      WHEN tm.ambiguity_count > 1 THEN 'normalized_title_ambiguous'
      ELSE 'no_match'
    END AS strategy,
    CASE
      WHEN es.certification_id IS NOT NULL THEN 1.00
      WHEN tm.ambiguity_count = 1 THEN 0.85
      WHEN tm.ambiguity_count > 1 THEN 0.50
      ELSE 0.00
    END::numeric AS confidence,
    COALESCE(tm.ambiguity_count, 0) AS ambiguity_count
  FROM cat
  LEFT JOIN exact_slug es ON cat.catalog_id = es.catalog_id
  LEFT JOIN title_match tm ON cat.catalog_id = tm.catalog_id
)
SELECT
  catalog_id, catalog_slug, catalog_title, current_link,
  candidate_certification_id, strategy, confidence, ambiguity_count,
  CASE WHEN current_link IS NOT NULL THEN false
       WHEN strategy IN ('exact_slug','normalized_title_unique') THEN false
       ELSE true END AS requires_manual_review,
  CASE WHEN current_link IS NOT NULL THEN 'ALREADY_LINKED'
       WHEN strategy = 'exact_slug' THEN 'AUTO_EXACT_SLUG'
       WHEN strategy = 'normalized_title_unique' THEN 'AUTO_TITLE_UNIQUE'
       WHEN strategy = 'normalized_title_ambiguous' THEN 'MANUAL_AMBIGUOUS'
       ELSE 'MANUAL_NO_MATCH' END AS decision
FROM classified;

REVOKE ALL ON public.v_catalog_certification_link_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_catalog_certification_link_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.admin_backfill_catalog_certification_links(
  p_limit integer DEFAULT 50,
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scanned int := 0; v_auto int := 0; v_ambig int := 0; v_nomatch int := 0;
  r record; v_applied jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR r IN
    SELECT * FROM public.v_catalog_certification_link_candidates
    WHERE current_link IS NULL
    ORDER BY confidence DESC, catalog_slug
    LIMIT GREATEST(p_limit, 1)
  LOOP
    v_scanned := v_scanned + 1;
    PERFORM public.fn_emit_audit(
      'catalog_cert_link_backfill_detected'::text,
      'catalog'::text, r.catalog_id::text, 'detected'::text,
      jsonb_build_object('catalog_id', r.catalog_id, 'strategy', r.strategy,
        'confidence', r.confidence, 'ambiguity_count', r.ambiguity_count,
        'dry_run', p_dry_run),
      'admin_backfill_catalog_certification_links'::text, NULL::text
    );

    IF r.strategy IN ('exact_slug','normalized_title_unique')
       AND r.candidate_certification_id IS NOT NULL
       AND r.confidence >= 0.85 THEN
      IF NOT p_dry_run THEN
        UPDATE public.certification_catalog
           SET linked_certification_id = r.candidate_certification_id
         WHERE id = r.catalog_id AND linked_certification_id IS NULL;
      END IF;
      v_auto := v_auto + 1;
      v_applied := v_applied || jsonb_build_object(
        'catalog_id', r.catalog_id, 'catalog_slug', r.catalog_slug,
        'certification_id', r.candidate_certification_id,
        'strategy', r.strategy, 'confidence', r.confidence);
      PERFORM public.fn_emit_audit(
        'catalog_cert_link_backfill_applied'::text,
        'catalog'::text, r.catalog_id::text,
        CASE WHEN p_dry_run THEN 'dry_run' ELSE 'ok' END::text,
        jsonb_build_object('catalog_id', r.catalog_id,
          'certification_id', r.candidate_certification_id,
          'strategy', r.strategy, 'confidence', r.confidence,
          'dry_run', p_dry_run),
        'admin_backfill_catalog_certification_links'::text, NULL::text
      );
    ELSIF r.strategy = 'normalized_title_ambiguous' THEN
      v_ambig := v_ambig + 1;
      PERFORM public.fn_emit_audit(
        'catalog_cert_link_backfill_skipped_ambiguous'::text,
        'catalog'::text, r.catalog_id::text, 'skipped'::text,
        jsonb_build_object('catalog_id', r.catalog_id, 'strategy', r.strategy,
          'ambiguity_count', r.ambiguity_count),
        'admin_backfill_catalog_certification_links'::text, NULL::text
      );
    ELSE
      v_nomatch := v_nomatch + 1;
    END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'catalog_cert_link_backfill_summary'::text,
    'system'::text, NULL::text,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'ok' END::text,
    jsonb_build_object('scanned', v_scanned, 'auto_applied', v_auto,
      'skipped_ambiguous', v_ambig, 'no_match', v_nomatch, 'dry_run', p_dry_run),
    'admin_backfill_catalog_certification_links'::text, NULL::text
  );

  RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run,
    'scanned', v_scanned, 'auto_applied', v_auto,
    'skipped_ambiguous', v_ambig, 'no_match', v_nomatch,
    'applied', v_applied);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_catalog_certification_links(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_catalog_certification_links(integer, boolean) TO authenticated;

SELECT public.fn_emit_audit(
  'catalog_cert_link_backfill_summary'::text,
  'system'::text, NULL::text, 'ok'::text,
  jsonb_build_object('scanned', 0, 'auto_applied', 0, 'skipped_ambiguous', 0,
    'no_match', 0, 'dry_run', true,
    'note', 'E3b.2 foundation deployed'),
  'migration:e3b2'::text, NULL::text
);
