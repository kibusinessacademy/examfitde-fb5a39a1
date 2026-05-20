-- =====================================================================
-- P6 — Crawl Observatory + Incremental Regeneration Hooks
-- =====================================================================

-- 1. Run-history table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.semantic_graph_materialization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NULL REFERENCES public.semantic_graph_snapshots(id) ON DELETE SET NULL,
  source_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('started','skipped_unchanged','published','failed')),
  entity_count integer NOT NULL DEFAULT 0,
  edge_count integer NOT NULL DEFAULT 0,
  orphan_count integer NOT NULL DEFAULT 0,
  route_count integer NOT NULL DEFAULT 0,
  sitemap_route_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  error_code text NULL,
  error_message text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sgmr_started_desc
  ON public.semantic_graph_materialization_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sgmr_status
  ON public.semantic_graph_materialization_runs (status, started_at DESC);

ALTER TABLE public.semantic_graph_materialization_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sgmr_service_all ON public.semantic_graph_materialization_runs;
CREATE POLICY sgmr_service_all ON public.semantic_graph_materialization_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- No anon/authenticated policy — read only via SECURITY DEFINER RPC.

REVOKE ALL ON public.semantic_graph_materialization_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.semantic_graph_materialization_runs TO service_role;

-- 2. Health view -------------------------------------------------------
CREATE OR REPLACE VIEW public.v_semantic_graph_crawl_health AS
WITH pub AS (
  SELECT id, snapshot_at, source_hash, entity_count, edge_count
  FROM public.semantic_graph_snapshots
  WHERE status = 'published'
  ORDER BY snapshot_at DESC
  LIMIT 1
),
orph AS (
  SELECT count(*)::int AS orphan_count
  FROM public.v_semantic_graph_orphans
),
last_run AS (
  SELECT *
  FROM public.semantic_graph_materialization_runs
  ORDER BY started_at DESC
  LIMIT 1
),
last_published AS (
  SELECT *
  FROM public.semantic_graph_materialization_runs
  WHERE status = 'published'
  ORDER BY started_at DESC
  LIMIT 1
)
SELECT
  pub.id                                                  AS published_snapshot_id,
  pub.snapshot_at                                         AS published_at,
  pub.source_hash                                         AS source_hash,
  CASE WHEN pub.snapshot_at IS NULL THEN NULL
       ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - pub.snapshot_at))/60.0)::int
  END                                                     AS snapshot_age_minutes,
  COALESCE(pub.entity_count, 0)                           AS entity_count,
  COALESCE(pub.edge_count, 0)                             AS edge_count,
  COALESCE(orph.orphan_count, 0)                          AS orphan_count,
  COALESCE(last_published.route_count, pub.entity_count, 0)         AS route_count,
  COALESCE(last_published.sitemap_route_count, last_published.route_count, 0) AS sitemap_route_count,
  CASE
    WHEN COALESCE(last_published.route_count, pub.entity_count, 0) = 0 THEN NULL
    ELSE ROUND(
      COALESCE(last_published.sitemap_route_count, last_published.route_count, 0)::numeric
      / NULLIF(COALESCE(last_published.route_count, pub.entity_count, 0)::numeric, 0),
      4)
  END                                                     AS sitemap_coverage_ratio,
  CASE
    WHEN pub.id IS NULL THEN 'missing_snapshot'
    WHEN COALESCE(orph.orphan_count, 0) > 0 THEN 'orphan_risk'
    WHEN COALESCE(last_published.sitemap_route_count, last_published.route_count, 0)
         < COALESCE(last_published.route_count, pub.entity_count, 0)
         THEN 'sitemap_mismatch'
    WHEN EXTRACT(EPOCH FROM (now() - pub.snapshot_at))/60.0 > 1440 THEN 'stale'
    ELSE 'fresh'
  END                                                     AS freshness_state,
  last_run.status                                         AS last_materialization_status,
  last_run.started_at                                     AS last_materialization_at,
  last_run.error_code                                     AS last_error_code,
  last_run.error_message                                  AS last_error_message,
  CASE
    WHEN pub.id IS NULL THEN 'run_materializer'
    WHEN COALESCE(orph.orphan_count, 0) > 0 THEN 'inspect_orphans'
    WHEN COALESCE(last_published.sitemap_route_count, last_published.route_count, 0)
         < COALESCE(last_published.route_count, pub.entity_count, 0)
         THEN 'regenerate_sitemap'
    WHEN last_run.status = 'failed' THEN 'check_materializer_error'
    WHEN EXTRACT(EPOCH FROM (now() - pub.snapshot_at))/60.0 > 1440 THEN 'run_materializer'
    ELSE 'none'
  END                                                     AS recommended_action
FROM pub
FULL OUTER JOIN orph ON true
FULL OUTER JOIN last_run ON true
FULL OUTER JOIN last_published ON true;

REVOKE ALL ON public.v_semantic_graph_crawl_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_semantic_graph_crawl_health TO service_role;

-- 3. Admin RPCs (admin/service_role only) ------------------------------
CREATE OR REPLACE FUNCTION public.admin_semantic_graph_crawl_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean := false;
  _row public.v_semantic_graph_crawl_health%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    _is_admin := public.has_role(auth.uid(), 'admin');
  END IF;
  IF NOT _is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _row FROM public.v_semantic_graph_crawl_health;
  RETURN to_jsonb(_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_semantic_graph_crawl_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_semantic_graph_crawl_health() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_semantic_graph_materialization_history(_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean := false;
  _rows jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    _is_admin := public.has_role(auth.uid(), 'admin');
  END IF;
  IF NOT _is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(r ORDER BY r.started_at DESC), '[]'::jsonb)
    INTO _rows
  FROM (
    SELECT id, snapshot_id, source_hash, status,
           entity_count, edge_count, orphan_count,
           route_count, sitemap_route_count,
           started_at, finished_at, error_code, error_message
    FROM public.semantic_graph_materialization_runs
    ORDER BY started_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 100))
  ) r;
  RETURN _rows;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_semantic_graph_materialization_history(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_semantic_graph_materialization_history(integer) TO authenticated, service_role;

-- 4. Register job_type --------------------------------------------------
INSERT INTO public.ops_job_type_registry
  (job_type, pool, description, job_name, lane, is_governance, requires_package_id, is_active)
VALUES
  ('system_semantic_graph_materialize', 'core',
   'Rebuilds the semantic knowledge graph snapshot (P5). Idempotent per source_hash.',
   'system_semantic_graph_materialize', 'control', true, false, true)
ON CONFLICT (job_type) DO UPDATE SET
  description = EXCLUDED.description,
  lane = EXCLUDED.lane,
  is_governance = EXCLUDED.is_governance,
  requires_package_id = EXCLUDED.requires_package_id,
  is_active = true,
  updated_at = now();

-- 5. Request RPC (admin or service_role) -------------------------------
CREATE OR REPLACE FUNCTION public.admin_semantic_graph_request_materialization(_reason text DEFAULT 'manual_admin')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean := false;
  _idem text;
  _bucket text;
  _existing uuid;
  _job_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    _is_admin := public.has_role(auth.uid(), 'admin');
  END IF;
  IF NOT _is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  _reason := COALESCE(NULLIF(_reason, ''), 'manual_admin');
  -- 15-minute bucket → idempotency window
  _bucket := to_char(date_trunc('hour', now())
                     + (FLOOR(EXTRACT(MINUTE FROM now())::int / 15) * interval '15 minutes'),
                     'YYYY-MM-DD"T"HH24:MI');
  _idem := 'semantic_graph:' || _reason || ':' || _bucket;

  -- Existing open job in this window?
  SELECT id INTO _existing
  FROM public.job_queue
  WHERE job_type = 'system_semantic_graph_materialize'
    AND idempotency_key = _idem
    AND status IN ('pending','queued','processing')
  ORDER BY created_at DESC
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'created', false,
      'reason', 'active_job_present',
      'job_id', _existing,
      'idempotency_key', _idem
    );
  END IF;

  INSERT INTO public.job_queue (
    job_type, job_name, lane, status, priority,
    payload, idempotency_key, run_after, scheduled_at, meta
  ) VALUES (
    'system_semantic_graph_materialize',
    'system_semantic_graph_materialize',
    'control',
    'pending',
    5,
    jsonb_build_object(
      'reason', _reason,
      'requested_at', now(),
      'idempotency_key', _idem
    ),
    _idem,
    now(),
    now(),
    jsonb_build_object('producer', 'admin_semantic_graph_request_materialization')
  )
  RETURNING id INTO _job_id;

  -- Audit (fail-soft)
  BEGIN
    PERFORM public.fn_emit_audit(
      'semantic_graph_materialization_requested',
      jsonb_build_object('job_id', _job_id, 'reason', _reason, 'idempotency_key', _idem)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'created', true,
    'job_id', _job_id,
    'idempotency_key', _idem
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_semantic_graph_request_materialization(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_semantic_graph_request_materialization(text) TO authenticated, service_role;

-- 6. Dirty-event triggers ---------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_semantic_graph_enqueue_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _idem text;
  _bucket text;
  _reason text;
BEGIN
  _reason := TG_ARGV[0];
  _bucket := to_char(date_trunc('hour', now())
                     + (FLOOR(EXTRACT(MINUTE FROM now())::int / 15) * interval '15 minutes'),
                     'YYYY-MM-DD"T"HH24:MI');
  _idem := 'semantic_graph:' || _reason || ':' || _bucket;

  -- One open job per (reason, 15-min bucket). Race-safe via UNIQUE-on-conflict-do-nothing
  BEGIN
    INSERT INTO public.job_queue (
      job_type, job_name, lane, status, priority,
      payload, idempotency_key, run_after, scheduled_at, meta
    ) VALUES (
      'system_semantic_graph_materialize',
      'system_semantic_graph_materialize',
      'control',
      'pending',
      6,
      jsonb_build_object(
        'reason', _reason,
        'source_table', TG_TABLE_NAME,
        'source_id', COALESCE((NEW).id::text, (OLD).id::text, NULL),
        'requested_at', now(),
        'idempotency_key', _idem
      ),
      _idem,
      now() + interval '60 seconds',  -- debounce: batch quick edits
      now() + interval '60 seconds',
      jsonb_build_object('producer', 'tg_semantic_graph_enqueue_dirty')
    );
  EXCEPTION
    WHEN unique_violation THEN NULL;
    WHEN OTHERS THEN NULL; -- never block the source mutation
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers (drop-then-create for idempotent migration)
DROP TRIGGER IF EXISTS trg_sg_dirty_certifications ON public.certifications;
CREATE TRIGGER trg_sg_dirty_certifications
  AFTER INSERT OR UPDATE OR DELETE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_semantic_graph_enqueue_dirty('certifications_changed');

DROP TRIGGER IF EXISTS trg_sg_dirty_curricula ON public.curricula;
CREATE TRIGGER trg_sg_dirty_curricula
  AFTER INSERT OR UPDATE OR DELETE ON public.curricula
  FOR EACH ROW EXECUTE FUNCTION public.tg_semantic_graph_enqueue_dirty('curricula_changed');

DROP TRIGGER IF EXISTS trg_sg_dirty_learning_fields ON public.learning_fields;
CREATE TRIGGER trg_sg_dirty_learning_fields
  AFTER INSERT OR UPDATE OR DELETE ON public.learning_fields
  FOR EACH ROW EXECUTE FUNCTION public.tg_semantic_graph_enqueue_dirty('learning_fields_changed');

DROP TRIGGER IF EXISTS trg_sg_dirty_competencies ON public.competencies;
CREATE TRIGGER trg_sg_dirty_competencies
  AFTER INSERT OR UPDATE OR DELETE ON public.competencies
  FOR EACH ROW EXECUTE FUNCTION public.tg_semantic_graph_enqueue_dirty('competencies_changed');

COMMENT ON FUNCTION public.tg_semantic_graph_enqueue_dirty IS
  'P6: Enqueues at most one system_semantic_graph_materialize job per (reason, 15-min bucket). Never blocks the source mutation.';
COMMENT ON VIEW public.v_semantic_graph_crawl_health IS
  'P6: Single-row health snapshot of the published semantic graph (freshness, orphans, sitemap coverage).';