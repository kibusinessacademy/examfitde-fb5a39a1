
-- =========================================================================
-- SEO Knowledge OS — Cut B: seo_refresh_queue Producer
-- Detail: mem://strategie/seo-knowledge-os-audit-v1
-- Sources EXCLUSIVELY from v_seo_content_node_ssot (Cut A SSOT view).
-- Writes ONLY to existing public.seo_refresh_queue.
-- No new tables, no new queue, no AI augmentation.
-- =========================================================================

-- 1) Audit contract registration (idempotent)
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('seo_refresh_queue_producer_run',  ARRAY['scanned','enqueued','skipped_existing'], 'seo_knowledge_os')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module,
      updated_at    = now();

-- 2) Producer (service-role / SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.fn_enqueue_seo_refresh_candidates(
  _limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scanned         integer := 0;
  v_enqueued        integer := 0;
  v_skipped         integer := 0;
  v_by_reason       jsonb   := '{}'::jsonb;
  v_sample          jsonb   := '[]'::jsonb;
  v_cap             integer := GREATEST(1, COALESCE(_limit, 50));
BEGIN
  -- Build candidate set deterministically from SSOT view.
  -- Each (node, reason) combination is one row.
  WITH base AS (
    SELECT
      n.node_id,
      n.node_type,
      n.source_id,
      n.canonical_slug,
      n.canonical_url,
      n.title,
      n.is_indexable,
      n.updated_at,
      n.metadata
    FROM public.v_seo_content_node_ssot n
  ),
  candidates AS (
    -- canonical_recheck: indexable but missing/invalid slug
    SELECT b.*, 'canonical_recheck'::text AS reason, 2 AS priority
    FROM base b
    WHERE b.is_indexable = true
      AND (b.canonical_slug IS NULL OR b.canonical_slug !~ '^/')
    UNION ALL
    -- indexability_recheck: not indexable but has slug (worth checking why)
    SELECT b.*, 'indexability_recheck'::text, 3
    FROM base b
    WHERE b.is_indexable = false
      AND b.canonical_slug IS NOT NULL
    UNION ALL
    -- stale_content: indexable, slug present, not updated in 90+ days
    SELECT b.*, 'stale_content'::text, 5
    FROM base b
    WHERE b.is_indexable = true
      AND b.canonical_slug IS NOT NULL
      AND b.updated_at < now() - interval '90 days'
    UNION ALL
    -- missing_structured_data: indexable text-content nodes without schema marker
    SELECT b.*, 'missing_structured_data'::text, 6
    FROM base b
    WHERE b.is_indexable = true
      AND b.canonical_slug IS NOT NULL
      AND b.node_type IN ('blog_article','seo_content_page','glossary_page','certification_page')
      AND COALESCE((b.metadata ? 'structured_data'), false) = false
    UNION ALL
    -- missing_internal_links: indexable narrative nodes, stale link graph (>30d)
    SELECT b.*, 'missing_internal_links'::text, 7
    FROM base b
    WHERE b.is_indexable = true
      AND b.canonical_slug IS NOT NULL
      AND b.node_type IN ('blog_article','seo_content_page')
      AND b.updated_at < now() - interval '30 days'
  ),
  dedup_against_today AS (
    -- Idempotency: skip rows already present in queue for same (content,reason) today.
    SELECT c.*
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.seo_refresh_queue q
      WHERE q.content_type = c.node_type
        AND q.content_id   = c.source_id
        AND q.reason       = c.reason
        AND q.created_at::date = current_date
    )
  ),
  ranked AS (
    SELECT *, row_number() OVER (ORDER BY priority ASC, updated_at ASC NULLS LAST) AS rn
    FROM dedup_against_today
  ),
  to_insert AS (
    SELECT * FROM ranked WHERE rn <= v_cap
  ),
  inserted AS (
    INSERT INTO public.seo_refresh_queue (
      content_type, content_id, content_url, content_title, reason, priority, status
    )
    SELECT
      t.node_type,
      t.source_id,
      t.canonical_url,
      t.title,
      t.reason,
      t.priority,
      'pending'
    FROM to_insert t
    RETURNING content_type, content_id, reason
  )
  SELECT
    (SELECT count(*)::int FROM candidates),
    (SELECT count(*)::int FROM inserted),
    (SELECT count(*)::int FROM candidates) - (SELECT count(*)::int FROM dedup_against_today),
    COALESCE((
      SELECT jsonb_object_agg(reason, cnt)
      FROM (SELECT reason, count(*)::int AS cnt FROM inserted GROUP BY reason) r
    ), '{}'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'content_type', content_type,
        'content_id', content_id,
        'reason', reason
      ))
      FROM (SELECT * FROM inserted LIMIT 10) s
    ), '[]'::jsonb)
  INTO v_scanned, v_enqueued, v_skipped, v_by_reason, v_sample;

  -- Audit (best-effort; do not fail run on audit error).
  BEGIN
    PERFORM public.fn_emit_audit(
      'seo_refresh_queue_producer_run',
      'system',
      NULL,
      'success',
      jsonb_build_object(
        'scanned', v_scanned,
        'enqueued', v_enqueued,
        'skipped_existing', v_skipped,
        'by_reason', v_by_reason,
        'limit', v_cap
      ),
      'producer'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'enqueued', v_enqueued,
    'skipped_existing', v_skipped,
    'by_reason', v_by_reason,
    'sample_nodes', v_sample
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enqueue_seo_refresh_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_seo_refresh_candidates(integer) TO service_role;

-- 3) Admin wrapper (callable from UI)
CREATE OR REPLACE FUNCTION public.admin_enqueue_seo_refresh_candidates(
  _limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN public.fn_enqueue_seo_refresh_candidates(_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enqueue_seo_refresh_candidates(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_seo_refresh_candidates(integer) TO authenticated;

-- 4) Daily cron (low-volume, 03:41 UTC, limit 50).
-- Replace existing schedule with same name if present.
DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'seo-refresh-queue-producer-daily';
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$cron$;

SELECT cron.schedule(
  'seo-refresh-queue-producer-daily',
  '41 3 * * *',
  $$ SELECT public.fn_enqueue_seo_refresh_candidates(50); $$
);
