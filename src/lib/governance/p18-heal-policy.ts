/**
 * P18 Cut 2 — Bounded Heal Policy (PURE)
 *
 * Diese Datei enthält ausschließlich deterministische Logik:
 *   - Whitelist erlaubter Heal-Aktionen
 *   - Ableitung der erlaubten Aktionen pro Drift
 *   - Bau eines deterministischen Known-System-Suggestion-Markdowns
 *   - Validierung eines Heal-Requests
 *
 * KEIN Supabase-Import, KEIN DB-Call, KEIN Audit-Write.
 * Mutation passiert ausschließlich in `p18-heal-executor.functions.ts`.
 */

import type { DriftSignal, DriftType, DriftSeverity } from './p18-orchestrator';

// ─── Whitelist ──────────────────────────────────────────────────────
export type HealAction =
  | 'SUGGEST_KNOWN_SYSTEM_ENTRY'
  | 'EMIT_GOVERNANCE_AUDIT'
  | 'TRIGGER_QUALITY_GATE_RERUN';

export const P18_HEAL_WHITELIST: ReadonlyArray<HealAction> = [
  'SUGGEST_KNOWN_SYSTEM_ENTRY',
  'EMIT_GOVERNANCE_AUDIT',
  'TRIGGER_QUALITY_GATE_RERUN',
];

export function isP18HealActionAllowed(a: string): a is HealAction {
  return (P18_HEAL_WHITELIST as readonly string[]).includes(a);
}

/**
 * Deterministische Eligibility-Tabellen.
 * Jede Drift hat exakt definierte allowed_actions.
 * EMIT_GOVERNANCE_AUDIT ist immer erlaubt (auch für block — als Eskalations-Audit).
 */
const SUGGEST_ELIGIBLE: ReadonlySet<DriftType> = new Set<DriftType>([
  'orphan_node',
  'healability_missing',
  'duplicate_registration',
  'reuse_recommendation',
]);

const QUALITY_GATE_ELIGIBLE: ReadonlySet<DriftType> = new Set<DriftType>([
  'cross_domain_unbridged',
  'rule_violation',
]);

export function isQualityGateRelevant(driftType: DriftType): boolean {
  return QUALITY_GATE_ELIGIBLE.has(driftType);
}

/**
 * Liefert die deterministisch erlaubten Aktionen für einen Drift.
 * Reihenfolge ist stabil — UI darf darauf vertrauen.
 */
export function deriveAllowedHealActions(drift: Pick<DriftSignal, 'drift_type' | 'severity'>): HealAction[] {
  const out: HealAction[] = [];
  if (SUGGEST_ELIGIBLE.has(drift.drift_type)) out.push('SUGGEST_KNOWN_SYSTEM_ENTRY');
  // Audit ist universell erlaubt — bewusst, weil bounded und PII-arm.
  out.push('EMIT_GOVERNANCE_AUDIT');
  if (QUALITY_GATE_ELIGIBLE.has(drift.drift_type)) out.push('TRIGGER_QUALITY_GATE_RERUN');
  return out;
}

// ─── Known-System-Suggestion (kein Write, nur Vorschlag) ─────────────
export interface KnownSystemSuggestion {
  suggested_system_id: string;
  domain: string;
  purpose: string;
  reuse_neighbors: string[];
  required_bridge_targets: string[];
  reason: string;
  copyable_markdown: string;
}

const DOMAIN_GUESS: Record<DriftType, string> = {
  orphan_node: 'governance',
  healability_missing: 'governance',
  duplicate_registration: 'governance',
  reuse_recommendation: 'architecture',
  ssot_conflict: 'architecture',
  cross_domain_unbridged: 'architecture',
  rule_violation: 'governance',
};

export function buildKnownSystemSuggestion(drift: DriftSignal): KnownSystemSuggestion {
  const target = drift.evidence.matched_systems[0] ?? 'unknown_target';
  const id = `${target}__${drift.drift_type}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const neighbors = drift.evidence.matched_systems.slice(1);
  const bridgeTargets = drift.drift_type === 'cross_domain_unbridged'
    ? drift.evidence.matched_systems
    : [];

  const md = [
    `### Vorschlag: known-systems-Eintrag`,
    ``,
    `- **id**: \`${id}\``,
    `- **domain**: \`${DOMAIN_GUESS[drift.drift_type]}\``,
    `- **purpose**: ${drift.message}`,
    `- **drift_type**: \`${drift.drift_type}\``,
    `- **severity**: \`${drift.severity}\``,
    `- **idempotency_key**: \`${drift.idempotency_key}\``,
    `- **reuse_neighbors**: ${neighbors.length ? neighbors.map((n) => `\`${n}\``).join(', ') : '_keine_'}`,
    `- **required_bridge_targets**: ${bridgeTargets.length ? bridgeTargets.map((n) => `\`${n}\``).join(', ') : '_keine_'}`,
    ``,
    `> Manuelle Pflege in \`src/lib/governance/known-systems.ts\` durch Architect.`,
    `> P18 schreibt **NICHT** automatisch in die Registry.`,
  ].join('\n');

  return {
    suggested_system_id: id,
    domain: DOMAIN_GUESS[drift.drift_type],
    purpose: drift.message,
    reuse_neighbors: neighbors,
    required_bridge_targets: bridgeTargets,
    reason: drift.evidence.recommended_action,
    copyable_markdown: md,
  };
}

// ─── Validierung eines Heal-Requests ────────────────────────────────
export interface HealRequest {
  idempotency_key: string;
  action: string;
  reason: string;
  /** Drift, gegen den geprüft wird (Eligibility) */
  drift: Pick<DriftSignal, 'drift_type' | 'severity' | 'idempotency_key'>;
}

export type HealValidation =
  | { ok: true; action: HealAction }
  | { ok: false; error: string };

export function validateP18HealRequest(req: HealRequest): HealValidation {
  if (!req.idempotency_key || req.idempotency_key.length < 8) {
    return { ok: false, error: 'idempotency_key invalid' };
  }
  if (req.idempotency_key !== req.drift.idempotency_key) {
    return { ok: false, error: 'idempotency_key mismatch with drift' };
  }
  if (!isP18HealActionAllowed(req.action)) {
    return { ok: false, error: `action "${req.action}" not in P18 whitelist` };
  }
  if (!req.reason || req.reason.trim().length < 8) {
    return { ok: false, error: 'reason must be at least 8 characters' };
  }
  const allowed = deriveAllowedHealActions(req.drift);
  if (!allowed.includes(req.action)) {
    return { ok: false, error: `action "${req.action}" not allowed for drift_type "${req.drift.drift_type}"` };
  }
  return { ok: true, action: req.action };
}

// ─── Audit-Metadata-Builder (PII-arm, kein raw payload) ─────────────
/**
 * Erzeugt strikt das Metadata-Set, das in fn_emit_audit verwendet werden DARF.
 * Keine raw proposals, keine secrets, keine vollständigen Payloads.
 */
export function buildAuditMetadata(
  drift: DriftSignal,
  requested_action: HealAction,
  result_status: 'success' | 'pending' | 'rejected' = 'pending',
): Record<string, unknown> {
  const allowed = deriveAllowedHealActions(drift);
  return {
    drift_type: drift.drift_type,
    trigger_source: drift.trigger,
    target_fingerprint: drift.evidence.target_fingerprint,
    policy_version: drift.policy_version,
    idempotency_key: drift.idempotency_key,
    verdict: drift.severity === 'block' ? 'review_required' : 'review',
    severity: drift.severity satisfies DriftSeverity,
    finding_count: 1,
    matched_system_ids: drift.evidence.matched_systems,
    requested_action,
    result_status,
    allowed_actions: allowed,
  };
}
