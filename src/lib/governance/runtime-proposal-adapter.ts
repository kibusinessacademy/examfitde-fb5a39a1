/**
 * Runtime Proposal Adapter — wandelt geplante Runtime-Aktionen
 * (Safe-Action / Scaffold / Auto-Heal-Dispatch) in eine ArchitectureProposal
 * um, damit reviewArchitecture() darauf läuft.
 *
 * v1.3: Healability + Event-Coupling werden mitgeführt, damit
 * HEALABILITY_IS_REQUIRED und EVENT_DRIVEN_BY_DEFAULT greifen können.
 *
 * Pure function. Keine Mutation, kein Supabase-Import, kein DB-Write.
 */

import type { ArchitectureProposal, ProposalKind } from './architecture-review';

export interface RuntimeActionPlan {
  /** z.B. 'enqueue_seo_wave', 'safe_action_dispatch', 'scaffold_export' */
  action_type: string;
  /** 'queue' | 'rpc' | 'edge_function' | 'cron' | 'registry' | 'audit_log' | 'table' | 'view' */
  target_type?: ProposalKind | string;
  /** name des Ziel-Systems oder der geplanten neuen Struktur */
  target_name: string;
  /** menschen-lesbarer Zweck */
  description?: string;
  planned_tables?: string[];
  planned_jobs?: string[];
  planned_events?: string[];
  planned_audit_actions?: string[];
  planned_routes?: string[];
  planned_edge_functions?: string[];
  tags?: string[];
  touches?: string[];
  governance?: {
    writesProductionAutonomously?: boolean;
    hasAuditContract?: boolean;
    hasStopCondition?: boolean;
    hasEligibilityGate?: boolean;
    rlsStatus?: 'on' | 'not_applicable' | 'off';
    usesHasRole?: boolean;
    hasHiddenState?: boolean;
  };
  /** v1.3 — Healability-Profil des Plans */
  healability?: {
    replayable?: boolean;
    recoverable?: boolean;
    auditable?: boolean;
    observable?: boolean;
    drift_detectable?: boolean;
  };
  /** v1.3 — Cross-Domain-Coupling */
  emits_events?: string[];
  consumes_events?: string[];
  isBridgeAdapter?: boolean;
}

const VALID_KINDS: ReadonlySet<ProposalKind> = new Set([
  'table', 'view', 'rpc', 'edge_function', 'queue', 'registry', 'cron', 'audit_log',
]);

function inferKind(plan: RuntimeActionPlan): ProposalKind {
  if (plan.target_type && VALID_KINDS.has(plan.target_type as ProposalKind)) {
    return plan.target_type as ProposalKind;
  }
  if ((plan.planned_jobs ?? []).length > 0) return 'queue';
  if ((plan.planned_audit_actions ?? []).length > 0) return 'audit_log';
  if ((plan.planned_events ?? []).length > 0) return 'table';
  if ((plan.planned_edge_functions ?? []).length > 0) return 'edge_function';
  if ((plan.planned_tables ?? []).length > 0) return 'table';
  return 'rpc';
}

/**
 * Pure mapper: Runtime-Plan → ArchitectureProposal.
 * Ergebnis ist deterministisch, alle Listen sortiert.
 */
export function runtimePlanToProposal(plan: RuntimeActionPlan): ArchitectureProposal {
  const sort = (xs?: string[]) => (xs ? [...xs].map((s) => s.trim()).filter(Boolean).sort() : []);
  const kind = inferKind(plan);
  const purpose =
    plan.description?.trim() ||
    `Runtime-Action ${plan.action_type} auf ${plan.target_name}.`;
  return {
    kind,
    name: plan.target_name.trim(),
    purpose,
    tags: sort(plan.tags),
    touches: sort(plan.touches),
    proposed_tables: sort(plan.planned_tables),
    proposed_jobs: sort(plan.planned_jobs),
    proposed_events: sort(plan.planned_events),
    proposed_audit_actions: sort(plan.planned_audit_actions),
    proposed_routes: sort(plan.planned_routes),
    proposed_edge_functions: sort(plan.planned_edge_functions),
    writesProductionAutonomously: plan.governance?.writesProductionAutonomously ?? false,
    hasAuditContract: plan.governance?.hasAuditContract ?? false,
    hasStopCondition: plan.governance?.hasStopCondition ?? false,
    hasEligibilityGate: plan.governance?.hasEligibilityGate ?? false,
    rlsStatus: plan.governance?.rlsStatus ?? 'not_applicable',
    usesHasRole: plan.governance?.usesHasRole ?? true,
    hasHiddenState: plan.governance?.hasHiddenState ?? false,
    healability: plan.healability ?? undefined,
    emits_events: sort(plan.emits_events),
    consumes_events: sort(plan.consumes_events),
    isBridgeAdapter: plan.isBridgeAdapter ?? false,
  };
}
