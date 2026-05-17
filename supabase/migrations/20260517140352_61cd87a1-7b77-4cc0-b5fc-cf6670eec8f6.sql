
-- ─────────────────────────────────────────────────────────────
-- E3c — Internal-Link-Materialization Foundation
-- ─────────────────────────────────────────────────────────────

-- 1. Audit contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module, schema_version)
VALUES
  ('internal_link_materialization_detected',
   ARRAY['ready','already_active','blocked','total']::text[], 'seo', 1),
  ('internal_link_materialization_applied',
   ARRAY['suggestion_id','source_url','target_url','link_type','anchor_text','dry_run','correlation_id']::text[], 'seo', 1),
  ('internal_link_materialization_skipped',
   ARRAY['suggestion_id','decision','correlation_id']::text[], 'seo', 1),
  ('internal_link_materialization_summary',
   ARRAY['applied','skipped','dry_run','correlation_id','reason']::text[], 'seo', 1)
ON CONFLICT (action_type) DO NOTHING;

-- 2. SSOT view (service_role only)
CREATE OR REPLACE VIEW public.v_internal_link_materialization_candidates AS
WITH base AS (
  SELECT
    s.id                                                 AS suggestion_id,
    'seo_internal_link_suggestion'::text                 AS source_type,
    s.id                                                 AS source_id,
    s.source_url                                         AS source_slug,
    s.link_type                                          AS target_type,
    s.id                                                 AS target_id,
    s.target_url                                         AS target_slug,
    s.anchor_text,
    s.link_type,
    s.status                                             AS current_status,
    s.relevance_score,
    s.priority,
    -- "Published" semantics: route-based link_types are inherently published
    -- (resolved by React Router on real pages); only contextual blog links
    -- require a published seo_document on both ends.
    CASE
      WHEN s.link_type = 'contextual' THEN
        EXISTS (SELECT 1 FROM public.seo_documents d
                WHERE d.status = 'published' AND '/blog/'||d.slug = s.source_url)
      ELSE true
    END                                                  AS source_published,
    CASE
      WHEN s.link_type = 'contextual' THEN
        EXISTS (SELECT 1 FROM public.seo_documents d
                WHERE d.status = 'published' AND '/blog/'||d.slug = s.target_url)
      ELSE true
    END                                                  AS target_published
  FROM public.seo_internal_link_suggestions s
),
dups AS (
  SELECT source_url, target_url, link_type, COUNT(*) FILTER (WHERE status='active') active_cnt
  FROM public.seo_internal_link_suggestions
  GROUP BY 1,2,3
)
SELECT
  b.suggestion_id,
  b.source_type, b.source_id, b.source_slug,
  b.target_type, b.target_id, b.target_slug,
  b.anchor_text, b.link_type, b.current_status,
  b.relevance_score, b.priority,
  b.source_published, b.target_published,
  CASE
    WHEN b.current_status = 'active'                          THEN 'ALREADY_ACTIVE'
    WHEN b.anchor_text IS NULL OR length(btrim(b.anchor_text)) = 0
                                                              THEN 'ANCHOR_MISSING'
    WHEN b.source_slug IS NULL OR b.target_slug IS NULL
         OR b.source_slug = b.target_slug                     THEN 'UNSAFE_CONTENT_STATE'
    WHEN NOT b.source_published                               THEN 'SOURCE_NOT_PUBLISHED'
    WHEN NOT b.target_published                               THEN 'TARGET_NOT_PUBLISHED'
    WHEN COALESCE(d.active_cnt,0) > 0                         THEN 'DUPLICATE_LINK'
    WHEN b.current_status = 'suggested'                       THEN 'READY_TO_MATERIALIZE'
    ELSE 'NO_ACTION'
  END AS materialization_decision
FROM base b
LEFT JOIN dups d
  ON d.source_url = b.source_slug
 AND d.target_url = b.target_slug
 AND d.link_type  = b.link_type;

REVOKE ALL ON public.v_internal_link_materialization_candidates FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_internal_link_materialization_candidates TO service_role;

-- 3. Summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_internal_link_materialization_summary()
RETURNS TABLE(decision text, count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
    SELECT v.materialization_decision::text, COUNT(*)::bigint
    FROM public.v_internal_link_materialization_candidates v
    GROUP BY 1
    ORDER BY 2 DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_internal_link_materialization_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_internal_link_materialization_summary() TO authenticated, service_role;

-- 4. Recent-runs RPC
CREATE OR REPLACE FUNCTION public.admin_get_internal_link_materialization_recent(p_limit int DEFAULT 10)
RETURNS TABLE(
  id uuid, action_type text, result_status text,
  metadata jsonb, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
    SELECT l.id, l.action_type, l.result_status, l.metadata, l.created_at
    FROM public.auto_heal_log l
    WHERE l.action_type LIKE 'internal_link_materialization_%'
    ORDER BY l.created_at DESC
    LIMIT LEAST(GREATEST(p_limit,1),100);
END $$;
REVOKE ALL ON FUNCTION public.admin_get_internal_link_materialization_recent(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_internal_link_materialization_recent(int) TO authenticated, service_role;

-- 5. Materialization RPC
CREATE OR REPLACE FUNCTION public.admin_materialize_internal_links(
  p_limit   int     DEFAULT 25,
  p_dry_run boolean DEFAULT true,
  p_reason  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cap            int := LEAST(GREATEST(COALESCE(p_limit,25),1),100);
  v_correlation    uuid := gen_random_uuid();
  v_applied        int  := 0;
  v_skipped        int  := 0;
  v_ready          int  := 0;
  v_active         int  := 0;
  v_blocked        int  := 0;
  v_total          int  := 0;
  v_row            record;
  v_applied_ids    uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF NOT p_dry_run AND (p_reason IS NULL OR length(btrim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'live apply requires p_reason (>=5 chars)';
  END IF;

  -- Detect snapshot
  SELECT
    COUNT(*)                                                                AS total,
    COUNT(*) FILTER (WHERE materialization_decision='READY_TO_MATERIALIZE') AS ready,
    COUNT(*) FILTER (WHERE materialization_decision='ALREADY_ACTIVE')       AS active,
    COUNT(*) FILTER (WHERE materialization_decision NOT IN
                          ('READY_TO_MATERIALIZE','ALREADY_ACTIVE'))         AS blocked
  INTO v_total, v_ready, v_active, v_blocked
  FROM public.v_internal_link_materialization_candidates;

  PERFORM public.fn_emit_audit(
    'internal_link_materialization_detected',
    'seo_internal_link', v_correlation::text, 'success',
    jsonb_build_object(
      'ready', v_ready, 'already_active', v_active,
      'blocked', v_blocked, 'total', v_total,
      'correlation_id', v_correlation
    ),
    CASE WHEN p_dry_run THEN 'admin_dry_run' ELSE 'admin_live' END
  );

  -- Walk ready candidates up to cap
  FOR v_row IN
    SELECT *
    FROM public.v_internal_link_materialization_candidates
    WHERE materialization_decision = 'READY_TO_MATERIALIZE'
    ORDER BY priority NULLS LAST, relevance_score DESC NULLS LAST, suggestion_id
    LIMIT v_cap
  LOOP
    IF p_dry_run THEN
      v_applied := v_applied + 1;
      v_applied_ids := array_append(v_applied_ids, v_row.suggestion_id);
      PERFORM public.fn_emit_audit(
        'internal_link_materialization_applied',
        'seo_internal_link', v_row.suggestion_id::text, 'dry_run',
        jsonb_build_object(
          'suggestion_id', v_row.suggestion_id,
          'source_url',   v_row.source_slug,
          'target_url',   v_row.target_slug,
          'link_type',    v_row.link_type,
          'anchor_text',  v_row.anchor_text,
          'dry_run',      true,
          'correlation_id', v_correlation
        ),
        'admin_dry_run'
      );
    ELSE
      -- Idempotent flip; only flip if still suggested (race-safe)
      UPDATE public.seo_internal_link_suggestions
      SET status = 'active', updated_at = now()
      WHERE id = v_row.suggestion_id AND status = 'suggested';

      IF FOUND THEN
        v_applied := v_applied + 1;
        v_applied_ids := array_append(v_applied_ids, v_row.suggestion_id);
        PERFORM public.fn_emit_audit(
          'internal_link_materialization_applied',
          'seo_internal_link', v_row.suggestion_id::text, 'success',
          jsonb_build_object(
            'suggestion_id', v_row.suggestion_id,
            'source_url',   v_row.source_slug,
            'target_url',   v_row.target_slug,
            'link_type',    v_row.link_type,
            'anchor_text',  v_row.anchor_text,
            'dry_run',      false,
            'correlation_id', v_correlation
          ),
          'admin_live'
        );
      ELSE
        v_skipped := v_skipped + 1;
        PERFORM public.fn_emit_audit(
          'internal_link_materialization_skipped',
          'seo_internal_link', v_row.suggestion_id::text, 'noop',
          jsonb_build_object(
            'suggestion_id', v_row.suggestion_id,
            'decision', 'RACE_NOT_SUGGESTED',
            'correlation_id', v_correlation
          ),
          'admin_live'
        );
      END IF;
    END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'internal_link_materialization_summary',
    'seo_internal_link', v_correlation::text, 'success',
    jsonb_build_object(
      'applied', v_applied,
      'skipped', v_skipped,
      'dry_run', p_dry_run,
      'correlation_id', v_correlation,
      'reason', COALESCE(p_reason,'(dry_run)'),
      'cap', v_cap,
      'detected', jsonb_build_object('ready',v_ready,'already_active',v_active,'blocked',v_blocked,'total',v_total)
    ),
    CASE WHEN p_dry_run THEN 'admin_dry_run' ELSE 'admin_live' END
  );

  RETURN jsonb_build_object(
    'correlation_id', v_correlation,
    'dry_run', p_dry_run,
    'cap', v_cap,
    'applied', v_applied,
    'skipped', v_skipped,
    'applied_ids', to_jsonb(v_applied_ids),
    'detected', jsonb_build_object(
      'ready', v_ready, 'already_active', v_active,
      'blocked', v_blocked, 'total', v_total
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_materialize_internal_links(int,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_materialize_internal_links(int,boolean,text) TO authenticated, service_role;

-- 6. Foundation audit
DO $$
DECLARE v_corr uuid := gen_random_uuid();
BEGIN
  PERFORM public.fn_emit_audit(
    'internal_link_materialization_summary',
    'seo_internal_link', v_corr::text, 'success',
    jsonb_build_object(
      'applied', 0, 'skipped', 0, 'dry_run', true,
      'correlation_id', v_corr,
      'reason', 'e3c_foundation_created'
    ),
    'migration'
  );
END $$;
