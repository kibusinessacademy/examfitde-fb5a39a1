
-- 1) Bridge candidate view (read-only, service_role)
CREATE OR REPLACE VIEW public.v_pillar_contextual_bridge_candidates AS
SELECT
  ba.id                              AS blog_article_id,
  ba.slug                            AS blog_slug,
  ba.title                           AS blog_title,
  '/blog/' || ba.slug                AS blog_url,
  csp.id                             AS pillar_page_id,
  csp.slug                           AS pillar_slug,
  csp.title                          AS pillar_title,
  '/pruefungstraining/' || csp.slug  AS pillar_url,
  cc.title                           AS certification_title,
  cc.slug                            AS certification_slug,
  c.id                               AS curriculum_id,
  GREATEST(0, LEAST(100,
      30
      + CASE WHEN ba.competency_id IS NOT NULL THEN 20 ELSE 0 END
      + CASE WHEN cc.priority_score IS NOT NULL THEN LEAST(30, cc.priority_score::int) ELSE 0 END
      + CASE WHEN ba.is_winner THEN 20 ELSE 0 END
  ))                                 AS bridge_score,
  CASE WHEN ba.competency_id IS NOT NULL
       THEN 'CONTEXTUAL_BLOG_TO_PILLAR_WITH_COMPETENCY_ANCHOR'
       ELSE 'CONTEXTUAL_BLOG_TO_PILLAR_CURRICULUM_ANCHOR'
  END                                AS bridge_kind,
  jsonb_build_object(
    'blog_competency_id', ba.competency_id,
    'cert_priority_score', cc.priority_score,
    'is_winner', ba.is_winner
  )                                  AS evidence
FROM public.blog_articles ba
JOIN public.curricula c ON c.id = ba.source_curriculum_id
JOIN public.certification_catalog cc ON cc.id = c.certification_id
JOIN public.certification_seo_pages csp ON csp.certification_catalog_id = cc.id
WHERE ba.status = 'published'
  AND ba.source_curriculum_id IS NOT NULL
  AND csp.is_published = true;

REVOKE ALL ON public.v_pillar_contextual_bridge_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_contextual_bridge_candidates TO service_role;

-- 2) Admin RPC: dry-run default; materializes top-N into seo_internal_link_suggestions
CREATE OR REPLACE FUNCTION public.admin_e3e_suggest_pillar_contextual_bridges(
  p_cap int DEFAULT 50,
  p_min_score int DEFAULT 50,
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap int := LEAST(GREATEST(COALESCE(p_cap,50),1), 100);
  v_min int := GREATEST(COALESCE(p_min_score,50), 0);
  v_inserted int := 0;
  v_skipped int := 0;
  v_candidates int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COUNT(*) INTO v_candidates
  FROM public.v_pillar_contextual_bridge_candidates
  WHERE bridge_score >= v_min;

  IF NOT p_dry_run THEN
    WITH src AS (
      SELECT * FROM public.v_pillar_contextual_bridge_candidates
      WHERE bridge_score >= v_min
      ORDER BY bridge_score DESC, blog_article_id
      LIMIT v_cap
    ),
    ins AS (
      INSERT INTO public.seo_internal_link_suggestions
        (source_url, source_title, target_url, target_title, anchor_text, relevance_score, link_type, priority, reason, status, source_doc_id)
      SELECT
        s.blog_url, s.blog_title,
        s.pillar_url, s.pillar_title,
        s.certification_title,
        s.bridge_score / 100.0,
        'pillar_contextual_bridge',
        s.bridge_score,
        s.bridge_kind || ' :: ' || s.evidence::text,
        'suggested',
        s.blog_article_id
      FROM src s
      WHERE NOT EXISTS (
        SELECT 1 FROM public.seo_internal_link_suggestions x
        WHERE x.source_url = s.blog_url AND x.target_url = s.pillar_url AND x.link_type = 'pillar_contextual_bridge'
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;
    v_skipped := v_cap - v_inserted;
  END IF;

  PERFORM public.fn_emit_audit(
    _action_type := 'e3e_pillar_contextual_bridge_run',
    _target_type := 'system',
    _target_id := NULL,
    _result_status := 'success',
    _payload := jsonb_build_object(
      'dry_run', p_dry_run,
      'cap', v_cap,
      'min_score', v_min,
      'candidate_count', v_candidates,
      'inserted', v_inserted,
      'skipped_duplicates', GREATEST(v_skipped,0)
    ),
    _trigger_source := 'admin_e3e_suggest_pillar_contextual_bridges',
    _error_message := NULL
  );

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'candidate_count', v_candidates,
    'cap', v_cap,
    'min_score', v_min,
    'inserted', v_inserted
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_e3e_suggest_pillar_contextual_bridges(int,int,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_e3e_suggest_pillar_contextual_bridges(int,int,boolean) TO authenticated, service_role;

-- 3) Audit contract
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('e3e_pillar_contextual_bridge_run',
        ARRAY['dry_run','cap','min_score','candidate_count','inserted']::text[],
        'seo_e3e_bridging')
ON CONFLICT (action_type) DO UPDATE SET required_keys = EXCLUDED.required_keys, owner_module = EXCLUDED.owner_module;

-- 4) Baseline snapshot (dry-run effect captured via direct fn_emit_audit so we get the candidate count NOW)
DO $$
DECLARE v_c int;
BEGIN
  SELECT COUNT(*) INTO v_c FROM public.v_pillar_contextual_bridge_candidates;
  PERFORM public.fn_emit_audit(
    _action_type := 'e3e_pillar_contextual_bridge_run',
    _target_type := 'system',
    _target_id := NULL,
    _result_status := 'success',
    _payload := jsonb_build_object('dry_run', true, 'cap', 0, 'min_score', 0, 'candidate_count', v_c, 'inserted', 0, 'note', 'baseline_after_migration'),
    _trigger_source := 'migration_e3e_baseline',
    _error_message := NULL
  );
END $$;
