/**
 * P18 — Semantic Healing Orchestrator (Cut 1)
 *
 * Pure, read-only Detection + Classification + Evidence-Layer.
 *
 * Cut 1 aktiviert NUR zwei Trigger-Quellen:
 *   1. known-systems-change       (Registry-Snapshot)
 *   2. architecture-review-done   (ArchitectureReview-Output)
 *
 * Cut 1 mutiert NICHTS. Kein Audit-Write. Kein Proposal-Write. Kein DB-Call.
 * Output ist ein deterministischer Drift-Korpus (DriftSignal[]).
 *
 * Idempotency-Key wird PRO Signal berechnet (Formel siehe contract v1),
 * aber NICHT persistiert — der Idempotency-Ledger ist Cut 3.
 *
 * Mentales Modell: semantische Architekturforensik, NICHT Self-Healing.
 */

import type { ArchitectureReview, RuleFinding } from './architecture-review';
import { KNOWN_SYSTEMS, type KnownSystem, type SystemDomain } from './known-systems';

// ─── Trigger-Topologie ──────────────────────────────────────────────
export type P18TriggerSource =
  // Cut 1 (aktiv)
  | 'known-systems-change'
  | 'architecture-review-done'
  // Cut 2+ (reserviert, in Cut 1 deaktiviert)
  | 'static-guard-failed'
  | 'runtime-anomaly-detected'
  | 'memory-sync-drift'
  | 'semantic-runtime-conflict';

export const P18_ACTIVE_TRIGGERS: ReadonlyArray<P18TriggerSource> = [
  'known-systems-change',
  'architecture-review-done',
];

export function isTriggerActive(t: P18TriggerSource): boolean {
  return (P18_ACTIVE_TRIGGERS as readonly P18TriggerSource[]).includes(t);
}

// ─── Drift-Klassifikation ────────────────────────────────────────────
export type DriftType =
  | 'ssot_conflict'
  | 'healability_missing'
  | 'cross_domain_unbridged'
  | 'orphan_node'
  | 'rule_violation'
  | 'reuse_recommendation'
  | 'duplicate_registration';

export type DriftCategory = 'architecture' | 'governance' | 'quality' | 'seo' | 'runtime';

export type DriftSeverity = 'block' | 'warn' | 'info';

export interface DriftEvidence {
  matched_systems: string[];
  recommended_action: string;
  escalation_target: 'human-architect' | 'auto-bounded-cut2' | 'observe-only';
  /** stabiler Hash des Drift-Targets — für Idempotency Key */
  target_fingerprint: string;
}

export interface DriftSignal {
  trigger: P18TriggerSource;
  drift_type: DriftType;
  category: DriftCategory;
  severity: DriftSeverity;
  /** menschen-lesbarer Befund */
  message: string;
  evidence: DriftEvidence;
  /** p18:{drift_type}:{target_fingerprint}:{policy_version}:{time_bucket} */
  idempotency_key: string;
  /** Trigger-spezifischer Ursprung (Findings-ID, System-Name) */
  source_ref: string;
  /** policy_version, gegen die klassifiziert wurde */
  policy_version: string;
  /** ISO-Zeitstempel der Detection (deterministisch via Param überschreibbar) */
  detected_at: string;
}

const POLICY_VERSION = 'p18-cut1.v1.0';

// ─── Hash & Time-Bucket ──────────────────────────────────────────────
/** stabiler 32-bit FNV-1a Hash → hex; deterministisch ohne Crypto-Dep. */
export function fingerprint(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function dayBucket(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function buildKey(driftType: DriftType, fp: string, bucket: string): string {
  return `p18:${driftType}:${fp}:${POLICY_VERSION}:${bucket}`;
}

// ─── Klassifikations-Tabellen ────────────────────────────────────────
const DRIFT_CATEGORY: Record<DriftType, DriftCategory> = {
  ssot_conflict: 'architecture',
  healability_missing: 'architecture',
  cross_domain_unbridged: 'architecture',
  orphan_node: 'architecture',
  rule_violation: 'governance',
  reuse_recommendation: 'architecture',
  duplicate_registration: 'governance',
};

const DRIFT_SEVERITY: Record<DriftType, DriftSeverity> = {
  ssot_conflict: 'block',
  healability_missing: 'block',
  duplicate_registration: 'block',
  cross_domain_unbridged: 'warn',
  rule_violation: 'warn',
  orphan_node: 'info',
  reuse_recommendation: 'info',
};

const ESCALATION: Record<DriftType, DriftEvidence['escalation_target']> = {
  ssot_conflict: 'human-architect',
  healability_missing: 'human-architect',
  duplicate_registration: 'human-architect',
  cross_domain_unbridged: 'auto-bounded-cut2',
  rule_violation: 'auto-bounded-cut2',
  orphan_node: 'observe-only',
  reuse_recommendation: 'observe-only',
};

// ─── Helper: Mutationspfad? ──────────────────────────────────────────
function isMutationPath(s: KnownSystem): boolean {
  if (s.kind === 'view' || s.kind === 'registry') return false;
  // Tabellen ohne audit_actions/event_contracts gelten als reine Read-Stores nur,
  // wenn explizit kein governance_tier='core'. Konservativ: alles außer view/registry.
  return true;
}

function hasFullHealability(s: KnownSystem): boolean {
  const h = s.healing_context;
  if (!h) return false;
  return Boolean(
    h.replayable && h.recoverable && h.auditable && h.observable && h.drift_detectable,
  );
}

// ─── Trigger 1: known-systems-change ─────────────────────────────────
export interface KnownSystemsChangeInput {
  /** Snapshot — default: current KNOWN_SYSTEMS */
  systems?: KnownSystem[];
  /** optional: Namen die als „neu/geändert" markiert sind (für gezielte Detection) */
  changed_names?: string[];
  now?: Date;
}

export function detectFromKnownSystemsChange(
  input: KnownSystemsChangeInput = {},
): DriftSignal[] {
  const systems = input.systems ?? KNOWN_SYSTEMS;
  const now = input.now ?? new Date(0); // deterministisch in Tests
  const bucket = dayBucket(now);
  const out: DriftSignal[] = [];

  // 1) duplicate_registration
  const seen = new Map<string, number>();
  for (const s of systems) seen.set(s.name, (seen.get(s.name) ?? 0) + 1);
  for (const [name, count] of seen.entries()) {
    if (count <= 1) continue;
    const fp = fingerprint(`dup:${name}`);
    out.push({
      trigger: 'known-systems-change',
      drift_type: 'duplicate_registration',
      category: DRIFT_CATEGORY.duplicate_registration,
      severity: DRIFT_SEVERITY.duplicate_registration,
      message: `Registry enthält ${count}× "${name}" — Identity-Contract verletzt.`,
      evidence: {
        matched_systems: [name],
        recommended_action: 'Doppelten Registry-Eintrag entfernen; ein Eintrag pro SSOT.',
        escalation_target: ESCALATION.duplicate_registration,
        target_fingerprint: fp,
      },
      idempotency_key: buildKey('duplicate_registration', fp, bucket),
      source_ref: `known-systems[name=${name}]`,
      policy_version: POLICY_VERSION,
      detected_at: now.toISOString(),
    });
  }

  // 2) healability_missing — Mutationspfad ohne volle Healability
  // 3) orphan_node           — keine Nachbarn, keine Events, keine Audit-Actions
  // 4) cross_domain_unbridged — Nachbar in anderer Domain ohne Event-Contracts
  const byName = new Map(systems.map((s) => [s.name, s] as const));
  const filterToChanged = (s: KnownSystem) =>
    !input.changed_names || input.changed_names.includes(s.name);

  for (const s of systems.filter(filterToChanged)) {
    // healability
    if (isMutationPath(s) && !hasFullHealability(s)) {
      const fp = fingerprint(`heal:${s.name}`);
      out.push({
        trigger: 'known-systems-change',
        drift_type: 'healability_missing',
        category: DRIFT_CATEGORY.healability_missing,
        severity: DRIFT_SEVERITY.healability_missing,
        message: `${s.name} (${s.kind}) ist Mutationspfad ohne vollständige Healability.`,
        evidence: {
          matched_systems: [s.name],
          recommended_action:
            'healing_context mit replayable/recoverable/auditable/observable/drift_detectable=true ergänzen oder System als read-only kennzeichnen.',
          escalation_target: ESCALATION.healability_missing,
          target_fingerprint: fp,
        },
        idempotency_key: buildKey('healability_missing', fp, bucket),
        source_ref: `known-systems[name=${s.name}]`,
        policy_version: POLICY_VERSION,
        detected_at: now.toISOString(),
      });
    }

    // orphan
    const noNeighbors = !s.neighbors || s.neighbors.length === 0;
    const noEvents = !s.event_contracts || s.event_contracts.length === 0;
    const noAudit = !s.audit_actions || s.audit_actions.length === 0;
    if (noNeighbors && noEvents && noAudit) {
      const fp = fingerprint(`orphan:${s.name}`);
      out.push({
        trigger: 'known-systems-change',
        drift_type: 'orphan_node',
        category: DRIFT_CATEGORY.orphan_node,
        severity: DRIFT_SEVERITY.orphan_node,
        message: `${s.name} hat keine Nachbarn, keine Events, keine Audit-Actions — semantisch isoliert.`,
        evidence: {
          matched_systems: [s.name],
          recommended_action:
            'neighbors / event_contracts / audit_actions ergänzen ODER System aus Registry entfernen.',
          escalation_target: ESCALATION.orphan_node,
          target_fingerprint: fp,
        },
        idempotency_key: buildKey('orphan_node', fp, bucket),
        source_ref: `known-systems[name=${s.name}]`,
        policy_version: POLICY_VERSION,
        detected_at: now.toISOString(),
      });
    }

    // cross-domain unbridged
    if (s.domain && s.neighbors) {
      for (const nName of s.neighbors) {
        const n = byName.get(nName);
        if (!n || !n.domain) continue;
        if (n.domain === s.domain) continue;
        const aHasEvents = (s.event_contracts ?? []).length > 0;
        const bHasEvents = (n.event_contracts ?? []).length > 0;
        if (aHasEvents || bHasEvents) continue;
        // deterministische Reihenfolge der beiden Knoten in der Kante
        const [from, to] = [s.name, nName].sort();
        const fp = fingerprint(`xdomain:${from}->${to}`);
        // Dedupe: nur einmal pro ungeordneter Kante
        if (out.some((sig) => sig.evidence.target_fingerprint === fp)) continue;
        out.push({
          trigger: 'known-systems-change',
          drift_type: 'cross_domain_unbridged',
          category: DRIFT_CATEGORY.cross_domain_unbridged,
          severity: DRIFT_SEVERITY.cross_domain_unbridged,
          message: `Cross-Domain-Kante ${from} (${s.domain}) ↔ ${to} (${n.domain}) ohne event_contracts.`,
          evidence: {
            matched_systems: [from, to],
            recommended_action:
              'Bridge-Adapter markieren ODER event_contracts auf einer Seite ergänzen (EVENT_DRIVEN_BY_DEFAULT).',
            escalation_target: ESCALATION.cross_domain_unbridged,
            target_fingerprint: fp,
          },
          idempotency_key: buildKey('cross_domain_unbridged', fp, bucket),
          source_ref: `known-systems[edge=${from}->${to}]`,
          policy_version: POLICY_VERSION,
          detected_at: now.toISOString(),
        });
      }
    }
  }

  return sortDeterministic(out);
}

// ─── Trigger 2: architecture-review-done ─────────────────────────────
export interface ArchitectureReviewDoneInput {
  review: ArchitectureReview;
  now?: Date;
}

function classifyFinding(f: RuleFinding): DriftType {
  if (f.rule === 'NO_PARALLEL_SYSTEMS') return 'ssot_conflict';
  if (f.rule === 'HEALABILITY_IS_REQUIRED') return 'healability_missing';
  if (f.rule === 'EVENT_DRIVEN_BY_DEFAULT') return 'cross_domain_unbridged';
  return 'rule_violation';
}

export function detectFromArchitectureReview(
  input: ArchitectureReviewDoneInput,
): DriftSignal[] {
  const { review } = input;
  const now = input.now ?? new Date(0);
  const bucket = dayBucket(now);
  const out: DriftSignal[] = [];

  for (const f of review.findings) {
    const dt = classifyFinding(f);
    const fpInput = `review:${review.proposal.kind}:${review.proposal.name}:${f.rule}:${
      f.required_bridge_target ?? ''
    }`;
    const fp = fingerprint(fpInput);
    out.push({
      trigger: 'architecture-review-done',
      drift_type: dt,
      category: DRIFT_CATEGORY[dt],
      severity: f.severity, // review-Severity gewinnt (deterministisch)
      message: `[${f.rule}] ${f.message}`,
      evidence: {
        matched_systems: f.matched_known_systems.map((s) => s.name),
        recommended_action:
          f.recommended_reuse_path ??
          (f.migration_strategy ? f.migration_strategy.join(' ') : 'Siehe Architecture Review.'),
        escalation_target: ESCALATION[dt],
        target_fingerprint: fp,
      },
      idempotency_key: buildKey(dt, fp, bucket),
      source_ref: `review:${review.proposal.name}#${f.rule}`,
      policy_version: POLICY_VERSION,
      detected_at: now.toISOString(),
    });
  }

  // Reuse-Empfehlungen als info-Signale
  for (const c of review.reuse_candidates) {
    const fp = fingerprint(`reuse:${review.proposal.name}->${c.name}`);
    out.push({
      trigger: 'architecture-review-done',
      drift_type: 'reuse_recommendation',
      category: DRIFT_CATEGORY.reuse_recommendation,
      severity: 'info',
      message: `Mögliche Wiederverwendung: ${c.name} statt neuer Struktur "${review.proposal.name}".`,
      evidence: {
        matched_systems: [c.name],
        recommended_action: c.extensionHint ?? `Reuse von ${c.name} prüfen.`,
        escalation_target: 'observe-only',
        target_fingerprint: fp,
      },
      idempotency_key: buildKey('reuse_recommendation', fp, bucket),
      source_ref: `review:${review.proposal.name}#reuse:${c.name}`,
      policy_version: POLICY_VERSION,
      detected_at: now.toISOString(),
    });
  }

  return sortDeterministic(out);
}

// ─── Aggregator ──────────────────────────────────────────────────────
export interface P18Cut1RunInput {
  knownSystemsChange?: KnownSystemsChangeInput;
  architectureReviewDone?: ArchitectureReviewDoneInput;
  now?: Date;
}

export interface P18Cut1Result {
  policy_version: string;
  active_triggers: ReadonlyArray<P18TriggerSource>;
  signals: DriftSignal[];
  summary: {
    total: number;
    by_severity: Record<DriftSeverity, number>;
    by_drift_type: Record<DriftType, number>;
    by_trigger: Record<P18TriggerSource, number>;
  };
}

export function runP18Cut1(input: P18Cut1RunInput = {}): P18Cut1Result {
  const now = input.now ?? new Date(0);
  const signals: DriftSignal[] = [];
  if (input.knownSystemsChange !== undefined) {
    signals.push(...detectFromKnownSystemsChange({ ...input.knownSystemsChange, now }));
  }
  if (input.architectureReviewDone) {
    signals.push(...detectFromArchitectureReview({ ...input.architectureReviewDone, now }));
  }
  // Dedupe via idempotency_key
  const seen = new Set<string>();
  const unique = signals.filter((s) => {
    if (seen.has(s.idempotency_key)) return false;
    seen.add(s.idempotency_key);
    return true;
  });
  const sorted = sortDeterministic(unique);

  const by_severity: Record<DriftSeverity, number> = { block: 0, warn: 0, info: 0 };
  const by_drift_type = Object.fromEntries(
    (Object.keys(DRIFT_CATEGORY) as DriftType[]).map((k) => [k, 0]),
  ) as Record<DriftType, number>;
  const by_trigger: Record<P18TriggerSource, number> = {
    'known-systems-change': 0,
    'architecture-review-done': 0,
    'static-guard-failed': 0,
    'runtime-anomaly-detected': 0,
    'memory-sync-drift': 0,
    'semantic-runtime-conflict': 0,
  };
  for (const s of sorted) {
    by_severity[s.severity]++;
    by_drift_type[s.drift_type]++;
    by_trigger[s.trigger]++;
  }

  return {
    policy_version: POLICY_VERSION,
    active_triggers: P18_ACTIVE_TRIGGERS,
    signals: sorted,
    summary: {
      total: sorted.length,
      by_severity,
      by_drift_type,
      by_trigger,
    },
  };
}

function sortDeterministic(s: DriftSignal[]): DriftSignal[] {
  const SEV_ORDER: Record<DriftSeverity, number> = { block: 0, warn: 1, info: 2 };
  return [...s].sort((a, b) => {
    const sv = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    if (sv !== 0) return sv;
    if (a.drift_type !== b.drift_type) return a.drift_type.localeCompare(b.drift_type);
    return a.idempotency_key.localeCompare(b.idempotency_key);
  });
}

// re-exports für Konsumenten
export type { SystemDomain };
