
INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES
  ('catalog_cert_alias_created',
   ARRAY['catalog_id','certification_id','reason','decided_by'],
   'seo_identity_layer'),
  ('catalog_cert_alias_resolved',
   ARRAY['catalog_id','certification_id','reason','dry_run'],
   'seo_identity_layer'),
  ('catalog_cert_alias_rejected',
   ARRAY['catalog_id','reason','decided_by'],
   'seo_identity_layer'),
  ('e3b3_foundation_created',
   ARRAY['phase','components'],
   'seo_identity_layer')
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE r record; v_count int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.v_catalog_certification_link_candidates
    WHERE current_link IS NULL
      AND strategy IN ('exact_slug','normalized_title_unique')
      AND confidence >= 0.85
      AND candidate_certification_id IS NOT NULL
  LOOP
    UPDATE public.certification_catalog
       SET linked_certification_id = r.candidate_certification_id
     WHERE id = r.catalog_id AND linked_certification_id IS NULL;
    v_count := v_count + 1;
    PERFORM public.fn_emit_audit(
      'catalog_cert_link_backfill_applied'::text,
      'catalog'::text, r.catalog_id::text, 'ok'::text,
      jsonb_build_object('catalog_id', r.catalog_id,
        'certification_id', r.candidate_certification_id,
        'strategy', r.strategy, 'confidence', r.confidence,
        'dry_run', false, 'origin','e3b3_migration_apply'),
      'e3b3_migration'::text, NULL::text);
  END LOOP;
  PERFORM public.fn_emit_audit(
    'catalog_cert_link_backfill_summary'::text,
    'system'::text, NULL::text, 'ok'::text,
    jsonb_build_object('scanned', v_count, 'auto_applied', v_count,
      'skipped_ambiguous', 0, 'no_match', 0, 'dry_run', false,
      'origin','e3b3_migration_apply'),
    'e3b3_migration'::text, NULL::text);
END $$;

CREATE TABLE IF NOT EXISTS public.catalog_certification_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id uuid NOT NULL REFERENCES public.certification_catalog(id) ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual_resolve'
    CHECK (source IN ('manual_resolve','semi_auto','import')),
  reason text NOT NULL,
  decided_by uuid REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_cert_alias_active
  ON public.catalog_certification_aliases(catalog_id) WHERE is_active = true;

ALTER TABLE public.catalog_certification_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_catalog_cert_aliases" ON public.catalog_certification_aliases;
CREATE POLICY "admin_read_catalog_cert_aliases"
  ON public.catalog_certification_aliases FOR SELECT
  USING (public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "admin_write_catalog_cert_aliases" ON public.catalog_certification_aliases;
CREATE POLICY "admin_write_catalog_cert_aliases"
  ON public.catalog_certification_aliases FOR ALL
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

DROP VIEW IF EXISTS public.v_catalog_certification_link_candidates;
CREATE VIEW public.v_catalog_certification_link_candidates AS
WITH base AS (
  SELECT cc.id AS catalog_id, cc.slug AS catalog_slug, cc.title AS catalog_title,
         cc.linked_certification_id AS current_link
  FROM public.certification_catalog cc
),
alias_match AS (
  SELECT b.catalog_id, a.certification_id AS cand_id,
         'alias_override'::text AS strategy, 1.00::numeric AS confidence, 1::int AS ambiguity_count
  FROM base b
  JOIN public.catalog_certification_aliases a
    ON a.catalog_id = b.catalog_id AND a.is_active = true
),
exact_slug AS (
  SELECT b.catalog_id, c.id AS cand_id,
         'exact_slug'::text AS strategy, 1.00::numeric AS confidence, 1::int AS ambiguity_count
  FROM base b
  JOIN public.certifications c ON c.slug = b.catalog_slug
  WHERE NOT EXISTS (SELECT 1 FROM alias_match am WHERE am.catalog_id = b.catalog_id)
),
norm AS (
  SELECT b.catalog_id, c.id AS cand_id
  FROM base b
  JOIN public.certifications c
    ON lower(regexp_replace(c.title,'\s+',' ','g'))
     = lower(regexp_replace(b.catalog_title,'\s+',' ','g'))
  WHERE NOT EXISTS (SELECT 1 FROM alias_match am WHERE am.catalog_id = b.catalog_id)
    AND NOT EXISTS (SELECT 1 FROM exact_slug es WHERE es.catalog_id = b.catalog_id)
),
norm_agg AS (
  SELECT catalog_id, count(*)::int AS n,
         (array_agg(cand_id ORDER BY cand_id::text))[1] AS cand_id
  FROM norm GROUP BY catalog_id
),
norm_strat AS (
  SELECT catalog_id,
         CASE WHEN n = 1 THEN cand_id ELSE NULL::uuid END AS cand_id,
         CASE WHEN n = 1 THEN 'normalized_title_unique' ELSE 'normalized_title_ambiguous' END AS strategy,
         CASE WHEN n = 1 THEN 0.85 ELSE 0.50 END::numeric AS confidence,
         n AS ambiguity_count
  FROM norm_agg
),
unioned AS (
  SELECT * FROM alias_match
  UNION ALL SELECT * FROM exact_slug
  UNION ALL SELECT * FROM norm_strat
)
SELECT b.catalog_id, b.catalog_slug, b.catalog_title, b.current_link,
       u.cand_id AS candidate_certification_id,
       COALESCE(u.strategy, 'no_match') AS strategy,
       COALESCE(u.confidence, 0.00) AS confidence,
       COALESCE(u.ambiguity_count, 0) AS ambiguity_count,
       CASE
         WHEN b.current_link IS NOT NULL THEN false
         WHEN COALESCE(u.confidence,0) >= 0.85 THEN false
         ELSE true
       END AS requires_manual_review,
       CASE
         WHEN b.current_link IS NOT NULL THEN 'already_linked'
         WHEN COALESCE(u.strategy,'no_match') IN ('alias_override','exact_slug','normalized_title_unique')
              AND COALESCE(u.confidence,0) >= 0.85 THEN 'auto'
         WHEN COALESCE(u.strategy,'no_match') = 'normalized_title_ambiguous' THEN 'manual_ambiguous'
         ELSE 'no_match'
       END AS decision
FROM base b
LEFT JOIN unioned u ON u.catalog_id = b.catalog_id;

REVOKE ALL ON public.v_catalog_certification_link_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_catalog_certification_link_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.admin_resolve_ambiguous_catalog_link(
  p_catalog_id uuid, p_certification_id uuid, p_reason text, p_dry_run boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_catalog_title text; v_cert_title text; v_existing uuid;
BEGIN
  IF NOT public.has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (>=5 chars)';
  END IF;

  SELECT title INTO v_catalog_title FROM public.certification_catalog WHERE id = p_catalog_id;
  SELECT title INTO v_cert_title    FROM public.certifications      WHERE id = p_certification_id;
  IF v_catalog_title IS NULL OR v_cert_title IS NULL THEN
    RAISE EXCEPTION 'catalog_id or certification_id not found';
  END IF;

  SELECT certification_id INTO v_existing
  FROM public.catalog_certification_aliases
  WHERE catalog_id = p_catalog_id AND is_active = true;

  IF p_dry_run THEN
    PERFORM public.fn_emit_audit(
      'catalog_cert_alias_resolved'::text,
      'catalog'::text, p_catalog_id::text, 'dry_run'::text,
      jsonb_build_object('catalog_id',p_catalog_id,'certification_id',p_certification_id,
        'existing_alias',v_existing,'reason',p_reason,'dry_run',true),
      'admin_resolve_ambiguous_catalog_link'::text, NULL::text);
    RETURN jsonb_build_object('ok',true,'dry_run',true,
      'catalog_id',p_catalog_id,'certification_id',p_certification_id,
      'existing_alias',v_existing,'catalog_title',v_catalog_title,'certification_title',v_cert_title);
  END IF;

  UPDATE public.catalog_certification_aliases
     SET is_active = false, updated_at = now()
   WHERE catalog_id = p_catalog_id AND is_active = true;

  INSERT INTO public.catalog_certification_aliases
    (catalog_id, certification_id, source, reason, decided_by)
  VALUES (p_catalog_id, p_certification_id, 'manual_resolve', p_reason, v_uid);

  UPDATE public.certification_catalog
     SET linked_certification_id = p_certification_id
   WHERE id = p_catalog_id;

  PERFORM public.fn_emit_audit(
    'catalog_cert_alias_created'::text,
    'catalog'::text, p_catalog_id::text, 'ok'::text,
    jsonb_build_object('catalog_id',p_catalog_id,'certification_id',p_certification_id,
      'previous_alias',v_existing,'reason',p_reason,'decided_by',v_uid),
    'admin_resolve_ambiguous_catalog_link'::text, NULL::text);

  PERFORM public.fn_emit_audit(
    'catalog_cert_alias_resolved'::text,
    'catalog'::text, p_catalog_id::text, 'ok'::text,
    jsonb_build_object('catalog_id',p_catalog_id,'certification_id',p_certification_id,
      'existing_alias',v_existing,'reason',p_reason,'dry_run',false),
    'admin_resolve_ambiguous_catalog_link'::text, NULL::text);

  RETURN jsonb_build_object('ok',true,'dry_run',false,
    'catalog_id',p_catalog_id,'certification_id',p_certification_id,
    'previous_alias',v_existing);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_ambiguous_catalog_link(uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_ambiguous_catalog_link(uuid,uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_ambiguous_catalog_link(
  p_catalog_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (>=5 chars)';
  END IF;

  PERFORM public.fn_emit_audit(
    'catalog_cert_alias_rejected'::text,
    'catalog'::text, p_catalog_id::text, 'ok'::text,
    jsonb_build_object('catalog_id',p_catalog_id,'reason',p_reason,'decided_by',v_uid),
    'admin_reject_ambiguous_catalog_link'::text, NULL::text);

  RETURN jsonb_build_object('ok',true,'catalog_id',p_catalog_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reject_ambiguous_catalog_link(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_ambiguous_catalog_link(uuid,text) TO authenticated;

DO $$ BEGIN
  PERFORM public.fn_emit_audit(
    'e3b3_foundation_created'::text,
    'system'::text, NULL::text, 'ok'::text,
    jsonb_build_object('phase','E3b.3',
      'components',jsonb_build_array('catalog_certification_aliases',
        'admin_resolve_ambiguous_catalog_link','admin_reject_ambiguous_catalog_link',
        'v_catalog_certification_link_candidates+alias_override')),
    'e3b3_migration'::text, NULL::text);
END $$;
