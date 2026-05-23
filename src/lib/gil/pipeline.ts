/**
 * P19 — GIL Signal-Pipeline-Typen
 *
 * Collect → Normalize → Classify → Enrich → Link → Score → Detect → Act
 *
 * Pure types. Jede Stufe ist deterministisch und idempotent.
 * Stage 'Act' ist bewusst bounded — siehe GIL_ACT_WHITELIST.
 */

import type { GilAgentKind, GilSeverity } from './contracts';

export type GilStage =
  | 'collect'
  | 'normalize'
  | 'classify'
  | 'enrich'
  | 'link'
  | 'score'
  | 'detect'
  | 'act';

export const GIL_STAGES: readonly GilStage[] = [
  'collect',
  'normalize',
  'classify',
  'enrich',
  'link',
  'score',
  'detect',
  'act',
];

export interface GilRawSignal {
  source: string;
  kind: string;
  observedAt: string;
  raw: Record<string, unknown>;
}

export interface GilNormalizedSignal {
  signal_type: string;
  source: string;
  title: string;
  summary?: string;
  payload: Record<string, unknown>;
  observed_at: string;
}

export interface GilClassifiedSignal extends GilNormalizedSignal {
  severity: GilSeverity;
  competitor_id?: string | null;
}

export interface GilEnrichedSignal extends GilClassifiedSignal {
  evidence_refs: string[];
  related_topics: string[];
}

export interface GilLinkedSignal extends GilEnrichedSignal {
  related_signal_ids: string[];
}

export interface GilScoredSignal extends GilLinkedSignal {
  score: number;
}

export interface GilDetectedDrift {
  signal: GilScoredSignal;
  drift_type: string;
  severity: GilSeverity;
  fingerprint: string;
}

/**
 * Bounded "Act" whitelist — exhaustive list of allowed downstream effects.
 * Anything not in this list MUST escalate to a human (= produce an insight only).
 */
export const GIL_ACT_WHITELIST = [
  'record_market_signal',
  'record_agent_insight',
  'record_growth_briefing',
  'emit_governance_audit',
] as const;
export type GilActAction = (typeof GIL_ACT_WHITELIST)[number];

export interface GilAgentRunInput {
  agent: GilAgentKind;
  signals: readonly GilLinkedSignal[];
  research: readonly { topic: string; finding: string; confidence: number }[];
}

export interface GilAgentRunOutput {
  agent: GilAgentKind;
  insights: ReadonlyArray<{
    insight_type: string;
    title: string;
    summary?: string;
    severity: GilSeverity;
    score?: number;
    payload: Record<string, unknown>;
    related_signal_ids: string[];
  }>;
}
