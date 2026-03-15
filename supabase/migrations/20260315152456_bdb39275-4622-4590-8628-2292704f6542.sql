ALTER TABLE public.knowledge_graph_nodes ADD COLUMN IF NOT EXISTS source_key text;

-- Drop the old unique index that doesn't work for text-based keys
DROP INDEX IF EXISTS uq_kg_nodes_source;

-- Partial unique index for real SSOT nodes (uuid source_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_nodes_source_uuid
  ON public.knowledge_graph_nodes (source_table, source_id)
  WHERE source_id IS NOT NULL;

-- Partial unique index for synthetic nodes (text source_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_nodes_source_key
  ON public.knowledge_graph_nodes (source_table, source_key)
  WHERE source_key IS NOT NULL;