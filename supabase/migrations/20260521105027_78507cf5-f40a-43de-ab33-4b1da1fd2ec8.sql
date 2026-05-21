-- ============================================================================
-- P6 Cut 4 — GSC Reconciliation & Validation Workflow
-- ============================================================================

-- Decision enum
DO $$ BEGIN
  CREATE TYPE public.gsc_reconciliation_decision AS ENUM (
    'valid',
    'expected_noindex',
    'expected_redirect',
    'gone_expected',
    'needs_fix',
    'unclassified_needs_fix'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Validation workflow status
DO $$ BEGIN
  CREATE TYPE public.gsc_validation_status AS ENUM (
    'pending',
    'requested',
    'validated',
    'still_failing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Raw GSC problem-URL ingestion
CREATE TABLE IF NOT EXISTS public.gsc_problem_urls (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url                TEXT NOT NULL,
  path               TEXT NOT NULL,
  gsc_status         TEXT NOT NULL,            -- e.g. 'not_found_404','redirect','blocked_robots','soft_404','indexed_noindex'
  coverage_state     TEXT,                     -- raw GSC bucket label
  last_crawled_at    TIMESTAMPTZ,
  source_report      TEXT NOT NULL DEFAULT 'manual_import',
  batch_id           UUID,
  validation_status  public.gsc_validation_status NOT NULL DEFAULT 'pending',
  validation_requested_at TIMESTAMPTZ,
  notes              TEXT,
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gsc_problem_urls_url_uq UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_gsc_problem_urls_status ON public.gsc_problem_urls(gsc_status);
CREATE INDEX IF NOT EXISTS idx_gsc_problem_urls_validation ON public.gsc_problem_urls(validation_status);
CREATE INDEX IF NOT EXISTS idx_gsc_problem_urls_path ON public.gsc_problem_urls(path);
CREATE INDEX IF NOT EXISTS idx_gsc_problem_urls_batch ON public.gsc_problem_urls(batch_id);

ALTER TABLE public.gsc_problem_urls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gsc_problem_urls FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_problem_urls TO service_role;

CREATE OR REPLACE FUNCTION public.tg_gsc_problem_urls_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_gsc_problem_urls_touch ON public.gsc_problem_urls;
CREATE TRIGGER trg_gsc_problem_urls_touch
  BEFORE UPDATE ON public.gsc_problem_urls
  FOR EACH ROW EXECUTE FUNCTION public.tg_gsc_problem_urls_touch();

-- Audit log of classifications
CREATE TABLE IF NOT EXISTS public.gsc_reconciliation_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT NOT NULL,
  decision      public.gsc_reconciliation_decision NOT NULL,
  matched_pattern TEXT,
  matched_state public.route_crawl_state,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gsc_recon_audit_url ON public.gsc_reconciliation_audit(url);
CREATE INDEX IF NOT EXISTS idx_gsc_recon_audit_decision ON public.gsc_reconciliation_audit(decision);

ALTER TABLE public.gsc_reconciliation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gsc_reconciliation_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.gsc_reconciliation_audit TO service_role;

-- Classification: match URL path against route_crawl_policy
CREATE OR REPLACE FUNCTION public.fn_classify_gsc_url(
  _path TEXT,
  _gsc_status TEXT
)
RETURNS TABLE(
  decision public.gsc_reconciliation_decision,
  matched_pattern TEXT,
  matched_state public.route_crawl_state,
  redirect_to TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row RECORD;
BEGIN
  -- 1) exact match
  SELECT pattern, state, redirect_to
    INTO _row
  FROM public.route_crawl_policy
  WHERE match_type = 'exact' AND pattern = _path
  LIMIT 1;

  -- 2) longest prefix
  IF _row IS NULL THEN
    SELECT pattern, state, redirect_to
      INTO _row
    FROM public.route_crawl_policy
    WHERE match_type = 'prefix' AND _path LIKE pattern || '%'
    ORDER BY length(pattern) DESC
    LIMIT 1;
  END IF;

  -- 3) regex
  IF _row IS NULL THEN
    SELECT pattern, state, redirect_to
      INTO _row
    FROM public.route_crawl_policy
    WHERE match_type = 'regex' AND _path ~ pattern
    ORDER BY length(pattern) DESC
    LIMIT 1;
  END IF;

  IF _row IS NULL THEN
    decision := 'unclassified_needs_fix';
    matched_pattern := NULL;
    matched_state := NULL;
    redirect_to := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  matched_pattern := _row.pattern;
  matched_state := _row.state;
  redirect_to := _row.redirect_to;

  decision := CASE _row.state
    WHEN 'noindex'  THEN 'expected_noindex'::public.gsc_reconciliation_decision
    WHEN 'redirect' THEN 'expected_redirect'::public.gsc_reconciliation_decision
    WHEN 'gone'     THEN 'gone_expected'::public.gsc_reconciliation_decision
    WHEN 'index'    THEN
      CASE
        WHEN _gsc_status IS NULL OR _gsc_status IN ('valid','indexed') THEN 'valid'::public.gsc_reconciliation_decision
        ELSE 'needs_fix'::public.gsc_reconciliation_decision
      END
  END;

  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.fn_classify_gsc_url(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_classify_gsc_url(TEXT, TEXT) TO service_role;

-- Reconciliation view
CREATE OR REPLACE VIEW public.v_gsc_reconciliation AS
SELECT
  g.id,
  g.url,
  g.path,
  g.gsc_status,
  g.coverage_state,
  g.last_crawled_at,
  g.source_report,
  g.batch_id,
  g.validation_status,
  g.validation_requested_at,
  g.imported_at,
  c.decision,
  c.matched_pattern,
  c.matched_state,
  c.redirect_to
FROM public.gsc_problem_urls g
LEFT JOIN LATERAL public.fn_classify_gsc_url(g.path, g.gsc_status) c ON TRUE;

REVOKE ALL ON public.v_gsc_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_gsc_reconciliation TO service_role;

-- Audit contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('gsc_problem_urls_ingested',  ARRAY['batch_id','count','source'], 'seo_crawl_governance'),
  ('gsc_url_validation_requested', ARRAY['url','decision'],          'seo_crawl_governance')
ON CONFLICT (action_type) DO NOTHING;

-- Admin RPC: ingest GSC problem URLs (bulk)
CREATE OR REPLACE FUNCTION public.admin_ingest_gsc_problem_urls(_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _batch_id UUID := gen_random_uuid();
  _count INT := 0;
  _source TEXT := COALESCE(_rows->0->>'source_report', 'manual_import');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be a jsonb array';
  END IF;

  WITH parsed AS (
    SELECT
      (r->>'url')::TEXT                               AS url,
      COALESCE(NULLIF(r->>'path',''), regexp_replace((r->>'url'),'^https?://[^/]+','')) AS path,
      COALESCE(NULLIF(r->>'gsc_status',''), 'unknown') AS gsc_status,
      NULLIF(r->>'coverage_state','')                 AS coverage_state,
      NULLIF(r->>'last_crawled_at','')::TIMESTAMPTZ   AS last_crawled_at,
      COALESCE(NULLIF(r->>'source_report',''), _source) AS source_report
    FROM jsonb_array_elements(_rows) r
    WHERE r->>'url' IS NOT NULL AND r->>'url' <> ''
  ),
  ins AS (
    INSERT INTO public.gsc_problem_urls
      (url, path, gsc_status, coverage_state, last_crawled_at, source_report, batch_id)
    SELECT url, path, gsc_status, coverage_state, last_crawled_at, source_report, _batch_id
    FROM parsed
    ON CONFLICT (url) DO UPDATE SET
      gsc_status       = EXCLUDED.gsc_status,
      coverage_state   = EXCLUDED.coverage_state,
      last_crawled_at  = EXCLUDED.last_crawled_at,
      source_report    = EXCLUDED.source_report,
      batch_id         = EXCLUDED.batch_id,
      updated_at       = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO _count FROM ins;

  PERFORM public.fn_emit_audit(
    'gsc_problem_urls_ingested',
    NULL, NULL, NULL,
    jsonb_build_object('batch_id', _batch_id, 'count', _count, 'source', _source),
    'success'
  );

  RETURN jsonb_build_object('batch_id', _batch_id, 'count', _count);
END $$;

REVOKE ALL ON FUNCTION public.admin_ingest_gsc_problem_urls(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ingest_gsc_problem_urls(JSONB) TO authenticated, service_role;

-- Admin RPC: summary counts per decision
CREATE OR REPLACE FUNCTION public.admin_get_gsc_reconciliation_summary()
RETURNS TABLE(
  decision public.gsc_reconciliation_decision,
  total INT,
  pending_validation INT,
  requested INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    decision,
    COUNT(*)::INT AS total,
    COUNT(*) FILTER (WHERE validation_status = 'pending')::INT AS pending_validation,
    COUNT(*) FILTER (WHERE validation_status = 'requested')::INT AS requested
  FROM public.v_gsc_reconciliation
  WHERE public.has_role(auth.uid(), 'admin')
  GROUP BY decision
  ORDER BY decision;
$$;
REVOKE ALL ON FUNCTION public.admin_get_gsc_reconciliation_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_gsc_reconciliation_summary() TO authenticated, service_role;

-- Admin RPC: detail drilldown
CREATE OR REPLACE FUNCTION public.admin_get_gsc_reconciliation_detail(
  _decision public.gsc_reconciliation_decision DEFAULT NULL,
  _limit INT DEFAULT 200,
  _offset INT DEFAULT 0
)
RETURNS SETOF public.v_gsc_reconciliation
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT *
  FROM public.v_gsc_reconciliation
  WHERE public.has_role(auth.uid(), 'admin')
    AND (_decision IS NULL OR decision = _decision)
  ORDER BY decision, imported_at DESC
  LIMIT GREATEST(LEAST(_limit, 1000), 1)
  OFFSET GREATEST(_offset, 0);
$$;
REVOKE ALL ON FUNCTION public.admin_get_gsc_reconciliation_detail(public.gsc_reconciliation_decision, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_gsc_reconciliation_detail(public.gsc_reconciliation_decision, INT, INT) TO authenticated, service_role;

-- Admin RPC: mark URL for GSC re-validation
CREATE OR REPLACE FUNCTION public.admin_mark_gsc_url_for_validation(_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _decision public.gsc_reconciliation_decision;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT decision INTO _decision
  FROM public.v_gsc_reconciliation
  WHERE url = _url
  LIMIT 1;

  IF _decision IS NULL THEN
    RAISE EXCEPTION 'url not found: %', _url;
  END IF;

  UPDATE public.gsc_problem_urls
  SET validation_status = 'requested',
      validation_requested_at = now()
  WHERE url = _url;

  PERFORM public.fn_emit_audit(
    'gsc_url_validation_requested',
    NULL, NULL, NULL,
    jsonb_build_object('url', _url, 'decision', _decision::text),
    'success'
  );

  RETURN jsonb_build_object('url', _url, 'decision', _decision, 'validation_status', 'requested');
END $$;

REVOKE ALL ON FUNCTION public.admin_mark_gsc_url_for_validation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_gsc_url_for_validation(TEXT) TO authenticated, service_role;
