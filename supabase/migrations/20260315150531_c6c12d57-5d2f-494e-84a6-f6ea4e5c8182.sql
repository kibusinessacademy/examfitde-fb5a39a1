-- Knowledge Graph: Nodes, Edges, Enrichment Queue

CREATE TABLE IF NOT EXISTS public.knowledge_graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type text NOT NULL CHECK (
    node_type IN ('learning_field','competency','blueprint','concept','error_pattern')
  ),
  source_table text,
  source_id uuid,
  label text NOT NULL,
  normalized_label text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance text NOT NULL DEFAULT 'ssot' CHECK (
    provenance IN ('ssot','derived','ai_enriched')
  ),
  confidence numeric(5,4),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON public.knowledge_graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_source ON public.knowledge_graph_nodes(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_norm_label ON public.knowledge_graph_nodes(normalized_label);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_nodes_source ON public.knowledge_graph_nodes(source_table, source_id) WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.knowledge_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL REFERENCES public.knowledge_graph_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES public.knowledge_graph_nodes(id) ON DELETE CASCADE,
  edge_type text NOT NULL CHECK (
    edge_type IN ('belongs_to','tested_by','relates_to','confused_with','causes_error')
  ),
  weight numeric(6,4),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance text NOT NULL DEFAULT 'ssot' CHECK (
    provenance IN ('ssot','derived','ai_enriched')
  ),
  confidence numeric(5,4),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_kg_edge UNIQUE (from_node_id, to_node_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON public.knowledge_graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_to ON public.knowledge_graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_type ON public.knowledge_graph_edges(edge_type);

CREATE TABLE IF NOT EXISTS public.knowledge_graph_enrichment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_node_id uuid REFERENCES public.knowledge_graph_nodes(id) ON DELETE CASCADE,
  enrichment_type text NOT NULL CHECK (
    enrichment_type IN ('common_errors','contrast_concepts','related_concepts')
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','processing','completed','failed')
  ),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.knowledge_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_graph_enrichment_queue ENABLE ROW LEVEL SECURITY;