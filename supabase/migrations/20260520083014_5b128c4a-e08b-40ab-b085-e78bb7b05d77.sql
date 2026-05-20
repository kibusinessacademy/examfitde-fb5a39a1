
-- ============================================================
-- P5 — Semantic Knowledge Graph: snapshots, entities, edges
-- ============================================================

CREATE TABLE IF NOT EXISTS public.semantic_graph_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  source_hash text NOT NULL,
  entity_count integer NOT NULL DEFAULT 0,
  edge_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_graph_one_published
  ON public.semantic_graph_snapshots ((status))
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_semantic_graph_snapshots_status
  ON public.semantic_graph_snapshots (status, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS public.semantic_graph_entities (
  snapshot_id uuid NOT NULL REFERENCES public.semantic_graph_snapshots(id) ON DELETE CASCADE,
  entity_id text NOT NULL,
  kind text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (snapshot_id, entity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_graph_entities_key
  ON public.semantic_graph_entities (snapshot_id, kind, key);

CREATE INDEX IF NOT EXISTS idx_semantic_graph_entities_kind
  ON public.semantic_graph_entities (snapshot_id, kind);

CREATE TABLE IF NOT EXISTS public.semantic_graph_edges (
  snapshot_id uuid NOT NULL REFERENCES public.semantic_graph_snapshots(id) ON DELETE CASCADE,
  from_id text NOT NULL,
  to_id text NOT NULL,
  kind text NOT NULL,
  weight numeric,
  PRIMARY KEY (snapshot_id, from_id, to_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_semantic_graph_edges_from
  ON public.semantic_graph_edges (snapshot_id, from_id);
CREATE INDEX IF NOT EXISTS idx_semantic_graph_edges_to
  ON public.semantic_graph_edges (snapshot_id, to_id);

-- Orphan-prevention trigger: both endpoints must exist in the same snapshot.
CREATE OR REPLACE FUNCTION public.fn_guard_semantic_edge_no_orphan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.semantic_graph_entities
    WHERE snapshot_id = NEW.snapshot_id AND entity_id = NEW.from_id
  ) THEN
    RAISE EXCEPTION 'semantic_graph_edges: orphan from_id % in snapshot %', NEW.from_id, NEW.snapshot_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.semantic_graph_entities
    WHERE snapshot_id = NEW.snapshot_id AND entity_id = NEW.to_id
  ) THEN
    RAISE EXCEPTION 'semantic_graph_edges: orphan to_id % in snapshot %', NEW.to_id, NEW.snapshot_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_semantic_edge_no_orphan ON public.semantic_graph_edges;
CREATE TRIGGER trg_guard_semantic_edge_no_orphan
  BEFORE INSERT ON public.semantic_graph_edges
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_semantic_edge_no_orphan();

-- RLS
ALTER TABLE public.semantic_graph_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semantic_graph_entities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semantic_graph_edges     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_published_snapshot" ON public.semantic_graph_snapshots;
CREATE POLICY "read_published_snapshot" ON public.semantic_graph_snapshots
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "read_entities_of_published" ON public.semantic_graph_entities;
CREATE POLICY "read_entities_of_published" ON public.semantic_graph_entities
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.semantic_graph_snapshots s
                 WHERE s.id = snapshot_id AND s.status = 'published'));

DROP POLICY IF EXISTS "read_edges_of_published" ON public.semantic_graph_edges;
CREATE POLICY "read_edges_of_published" ON public.semantic_graph_edges
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.semantic_graph_snapshots s
                 WHERE s.id = snapshot_id AND s.status = 'published'));

-- Read-only view of the currently published graph
CREATE OR REPLACE VIEW public.v_semantic_graph_current AS
SELECT s.id AS snapshot_id, s.snapshot_at, s.source_hash,
       s.entity_count, s.edge_count, s.published_at
FROM public.semantic_graph_snapshots s
WHERE s.status = 'published';

-- Orphan-detection view (entities with no incoming AND no outgoing edges
-- inside the published snapshot — graph-level orphan = "not crawl-reachable").
CREATE OR REPLACE VIEW public.v_semantic_graph_orphans AS
WITH cur AS (
  SELECT id FROM public.semantic_graph_snapshots WHERE status = 'published'
)
SELECT e.snapshot_id, e.entity_id, e.kind, e.key, e.name
FROM public.semantic_graph_entities e
JOIN cur ON cur.id = e.snapshot_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.semantic_graph_edges x
  WHERE x.snapshot_id = e.snapshot_id
    AND (x.from_id = e.entity_id OR x.to_id = e.entity_id)
);

-- Public RPC: returns the published graph as a single JSON document.
-- Stable shape consumed by the client hook and the sitemap generator.
CREATE OR REPLACE FUNCTION public.semantic_graph_get_published()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cur AS (
    SELECT * FROM public.semantic_graph_snapshots
    WHERE status = 'published'
    ORDER BY published_at DESC NULLS LAST
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'snapshot_id',   cur.id,
       'snapshot_at',   to_char(cur.snapshot_at AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'source_hash',   cur.source_hash,
       'entity_count',  cur.entity_count,
       'edge_count',    cur.edge_count,
       'entities', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', entity_id, 'kind', kind, 'key', key,
            'name', name, 'description', description, 'meta', meta
          ) ORDER BY kind, key, entity_id)
          FROM public.semantic_graph_entities WHERE snapshot_id = cur.id
       ), '[]'::jsonb),
       'edges', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'from', from_id, 'to', to_id, 'kind', kind, 'weight', weight
          ) ORDER BY kind, from_id, to_id)
          FROM public.semantic_graph_edges WHERE snapshot_id = cur.id
       ), '[]'::jsonb)
     )
     FROM cur),
    jsonb_build_object(
      'snapshot_id', NULL,
      'snapshot_at', '1970-01-01T00:00:00.000Z',
      'source_hash', '',
      'entity_count', 0, 'edge_count', 0,
      'entities', '[]'::jsonb, 'edges', '[]'::jsonb
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.semantic_graph_get_published() TO anon, authenticated;

-- Atomic publish: archives previous published, marks new as published.
CREATE OR REPLACE FUNCTION public.semantic_graph_publish_snapshot(_snapshot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.semantic_graph_snapshots
     SET status = 'archived'
   WHERE status = 'published' AND id <> _snapshot_id;
  UPDATE public.semantic_graph_snapshots
     SET status = 'published', published_at = now()
   WHERE id = _snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.semantic_graph_publish_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.semantic_graph_publish_snapshot(uuid) TO service_role;
