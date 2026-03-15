/**
 * knowledge-graph/types.ts — Shared types for the Knowledge Graph system.
 */

export type NodeType = 'learning_field' | 'competency' | 'blueprint' | 'concept' | 'error_pattern';
export type EdgeType = 'belongs_to' | 'tested_by' | 'relates_to' | 'confused_with' | 'causes_error';
export type Provenance = 'ssot' | 'derived' | 'ai_enriched';

export interface KGNode {
  id?: string;
  node_type: NodeType;
  source_table: string | null;
  source_id: string | null;
  label: string;
  normalized_label: string;
  payload: Record<string, unknown>;
  provenance: Provenance;
  confidence: number | null;
  is_active: boolean;
}

export interface KGEdge {
  id?: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: EdgeType;
  weight: number | null;
  payload: Record<string, unknown>;
  provenance: Provenance;
  confidence: number | null;
  is_active: boolean;
}

export interface GraphContext {
  core_competency: string;
  related_concepts: string[];
  contrast_concepts: string[];
  common_errors: string[];
  learning_field: string;
  blueprint_name?: string;
}

export interface BuildResult {
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  edgesSkipped: number;
  errors: string[];
}
