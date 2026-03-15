/**
 * ai-gateway/types.ts — Shared types for the AI Generation Gateway.
 */

export interface AIGenerationPolicy {
  jobType: string;
  enabled: boolean;
  preferBatch: boolean;
  allowSync: boolean;
  requireDeficit: boolean;
  useCache: boolean;
  templateFirst: boolean;
  maxRetries: number;
  maxTokensOut?: number;
  maxBatchSize?: number;
  allowedModels: string[];
  defaultModel: string;
  dailyBudgetEur?: number;
  /** Canary rollout: 0-100, percentage of packages routed to batch */
  batchRolloutPct: number;
}

export interface DeficitResult {
  shouldGenerate: boolean;
  artifact: string;
  reason: string;
  targetCount?: number;
  actualCount?: number;
  missingCount?: number;
  details?: Record<string, unknown>;
}

export interface CacheHit {
  found: boolean;
  cacheId?: string;
  responseBody?: Record<string, unknown>;
  model?: string;
}

export type RoutingDecision =
  | "skipped"
  | "cache_hit"
  | "template_only"
  | "batch"
  | "sync";

export interface GatewayRequest {
  jobType: string;
  sourceTable?: string;
  sourceId?: string;
  sourceRef?: Record<string, unknown>;
  packageId?: string;
  courseId?: string;
  certificationId?: string;
  curriculumId?: string;
  targetArtifact: string;
  urgency?: "sync" | "async";
  qualityTier?: "draft" | "standard" | "premium";
  /** Pre-built messages for direct LLM dispatch */
  messages?: Array<{ role: string; content: string }>;
  /** Additional payload for domain-specific logic */
  payload?: Record<string, unknown>;
  /** Force sync execution */
  forceSyncMode?: boolean;
}

export interface GatewayResult {
  ok: boolean;
  requestId: string;
  status: string;
  routingMode: RoutingDecision;
  cacheHit: boolean;
  skipped: boolean;
  deficitResult?: DeficitResult;
  batchId?: string;
  error?: string;
}
