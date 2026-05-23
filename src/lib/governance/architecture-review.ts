/**
 * architecture-review v1.1 — heuristische Architekturprüfung VOR neuen Strukturen.
 *
 * Erzwingt die 10 Prinzipien aus architecture-rules.ts auf jedes Vorhaben:
 *   reuse vor rebuild · bridge vor duplicate · extend vor replace · consistency vor speed.
 *
 * v1.1 Änderungen:
 *   - Erweitertes Proposal-Schema (proposed_tables/jobs/events/audit_actions/routes/edge_functions)
 *   - Evidence-Layer pro Finding (matched_known_systems, recommended_reuse_path,
 *     required_bridge_target, migration_strategy)
 *   - Deterministisches Verhalten (gleiche Proposal → gleiches Ergebnis)
 *
 * Output ist IMMER ein Vorschlag (NO_AUTONOMOUS_PRODUCTION_WRITES). Kein DB-Write,
 * kein Supabase-Import. Funktion läuft client-side & in CI (Node mit type-strip).
 */

import { ARCHITECTURE_RULES, type ArchitectureRuleId, RULE_BY_ID } from './architecture-rules';
import { findSystemsByKeyword, findSystemsByTags, KNOWN_SYSTEMS, type KnownSystem } from './known-systems';

export type ProposalKind =
  | 'table'
  | 'view'
  | 'rpc'
  | 'edge_function'
  | 'queue'
  | 'registry'
  | 'cron'
  | 'audit_log';

export interface ArchitectureProposal {
  kind: ProposalKind;
  /** geplanter Name */
  name: string;
  /** Plain-Text-Zweck */
  purpose: string;
  /** thematische Tags */
  tags?: string[];
  /** Tabellen/Funktionen, die berührt werden */
  touches?: string[];

  // ── v1.1 Proposal-Inventar ─────────────────────────────────────────
  /** geplante neue Tabellen (CREATE TABLE …) */
  proposed_tables?: string[];
  /** geplante neue Jobs/Worker/Job-Types */
  proposed_jobs?: string[];
  /** geplante neue Event-Streams/Event-Tabellen */
  proposed_events?: string[];
  /** geplante neue Audit-action_types */
  proposed_audit_actions?: string[];
  /** geplante neue Admin-Routen */
  proposed_routes?: string[];
  /** geplante neue Edge Functions */
  proposed_edge_functions?: string[];

  // ── Governance-Flags ───────────────────────────────────────────────
  writesProductionAutonomously?: boolean;
  hasAuditContract?: boolean;
  hasStopCondition?: boolean;
  hasEligibilityGate?: boolean;
  rlsStatus?: 'on' | 'not_applicable' | 'off';
  usesHasRole?: boolean;
  hasHiddenState?: boolean;
}

export type Severity = 'block' | 'warn' | 'info';

export interface RuleFinding {
  rule: ArchitectureRuleId;
  severity: Severity;
  message: string;
  /** menschenlesbare Begründung mit Bezug auf konkrete Proposal-Felder */
  evidence: string;
  /** bestehende Systeme, die das Finding ausgelöst haben */
  matched_known_systems: KnownSystem[];
  /** empfohlener Reuse-Pfad (1 Satz, copy-paste-fähig) */
  recommended_reuse_path?: string;
  /** wenn Bridge statt Fork: das Ziel-System */
  required_bridge_target?: string;
  /** konkrete Migrationsschritte für genau dieses Finding */
  migration_strategy?: string[];
}

export interface ArchitectureReview {
  proposal: ArchitectureProposal;
  reuse_candidates: KnownSystem[];
  bridge_targets: KnownSystem[];
  findings: RuleFinding[];
  duplication_risk: RuleFinding[];
  governance_risk: RuleFinding[];
  /** verdichtete Migrationsstrategie (alle Findings zusammen) */
  migration_strategy: string[];
  recommended_extension_points: string[];
  verdict: 'approved' | 'review_required' | 'blocked';
}

// ─── Helpers ─────────────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3);
}

function findReuseCandidates(p: ArchitectureProposal): KnownSystem[] {
  const byTags = p.tags ? findSystemsByTags(p.tags) : [];
  const byPurpose = tokenize(p.purpose).flatMap((kw) => findSystemsByKeyword(kw));
  const byName = findSystemsByKeyword(p.name);
  const byTouches = (p.touches ?? []).flatMap((t) => findSystemsByKeyword(t));
  const seen = new Set<string>();
  const out: KnownSystem[] = [];
  for (const s of [...byTags, ...byPurpose, ...byName, ...byTouches]) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      out.push(s);
    }
  }
  // deterministisch sortieren
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
}

function findBridgeTargets(p: ArchitectureProposal, reuse: KnownSystem[]): KnownSystem[] {
  if (!p.touches || p.touches.length < 2) return [];
  const matched: KnownSystem[] = [];
  for (const t of p.touches) {
    matched.push(...findSystemsByKeyword(t).slice(0, 2));
  }
  const seen = new Set<string>();
  const merged = [...reuse, ...matched].filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
  return merged.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6);
}

/** findet ein KnownSystem anhand einer der Tag-Kombinationen */
function systemForTags(tags: string[]): KnownSystem | undefined {
  return KNOWN_SYSTEMS.find((s) => tags.every((t) => s.tags.includes(t)));
}

const AUDIT_SSOT = systemForTags(['audit', 'log']) ?? KNOWN_SYSTEMS.find((s) => s.name === 'auto_heal_log')!;
const CONVERSION_SSOT = KNOWN_SYSTEMS.find((s) => s.name === 'conversion_events')!;
const JOB_QUEUE_SSOT = KNOWN_SYSTEMS.find((s) => s.name === 'job_queue')!;
const AUDIT_REGISTRY = KNOWN_SYSTEMS.find((s) => s.name === 'ops_audit_contract')!;
const JOB_REGISTRY = KNOWN_SYSTEMS.find((s) => s.name === 'ops_job_type_registry')!;
const EMAIL_QUEUE = KNOWN_SYSTEMS.find((s) => s.name === 'email_delivery_queue')!;

// ─── Review ──────────────────────────────────────────────────────────
export function reviewArchitecture(proposal: ArchitectureProposal): ArchitectureReview {
  const findings: RuleFinding[] = [];
  const reuse = findReuseCandidates(proposal);
  const bridge = findBridgeTargets(proposal, reuse);

  // ── proposed_tables / proposed_jobs / proposed_events / proposed_audit_actions ──
  // NO_PARALLEL_SYSTEMS: neue Audit-Tabelle / Audit-Stream
  if (
    (proposal.kind === 'audit_log' || (proposal.proposed_tables ?? []).some((t) => /audit|guard|event_log/i.test(t))) &&
    AUDIT_SSOT
  ) {
    findings.push({
      rule: 'NO_PARALLEL_SYSTEMS',
      severity: 'block',
      message: `Audit-SSOT existiert: ${AUDIT_SSOT.name}.`,
      evidence: `proposal.kind="${proposal.kind}", proposed_tables=${JSON.stringify(proposal.proposed_tables ?? [])} würde einen zweiten Audit-Stream erzeugen.`,
      matched_known_systems: [AUDIT_SSOT, AUDIT_REGISTRY].filter(Boolean),
      recommended_reuse_path: `fn_emit_audit('${(proposal.proposed_audit_actions ?? [proposal.name])[0]}', …) auf ${AUDIT_SSOT.name}; action_type vorher in ${AUDIT_REGISTRY.name} registrieren.`,
      required_bridge_target: AUDIT_SSOT.name,
      migration_strategy: [
        `1) action_type in ${AUDIT_REGISTRY.name} registrieren (mit required_keys).`,
        `2) Statt neuer Tabelle: fn_emit_audit auf ${AUDIT_SSOT.name} verwenden.`,
        '3) Heal-Cockpit-Card auf bestehendes Audit-Filter erweitern.',
      ],
    });
  }

  // NO_PARALLEL_SYSTEMS: neue Queue
  if (
    (proposal.kind === 'queue' || (proposal.proposed_jobs ?? []).length > 0 ||
      (proposal.proposed_tables ?? []).some((t) => /queue|outbox|jobs?$/i.test(t))) &&
    JOB_QUEUE_SSOT
  ) {
    const isEmailLike = /email|mail|outbox/i.test(proposal.name + ' ' + proposal.purpose) ||
      (proposal.tags ?? []).some((t) => /email|mail/i.test(t));
    const target = isEmailLike ? EMAIL_QUEUE : JOB_QUEUE_SSOT;
    findings.push({
      rule: 'NO_PARALLEL_SYSTEMS',
      severity: 'block',
      message: `Queue-SSOT existiert: ${target.name}.`,
      evidence: `proposal.kind="${proposal.kind}", proposed_jobs=${JSON.stringify(proposal.proposed_jobs ?? [])}, proposed_tables=${JSON.stringify(proposal.proposed_tables ?? [])} würde eine konkurrierende Queue erzeugen.`,
      matched_known_systems: [target, JOB_REGISTRY].filter(Boolean),
      recommended_reuse_path: isEmailLike
        ? `INSERT INTO ${target.name} mit idempotency_key + email-sequence-worker dispatcht.`
        : `Neuen job_type in ${JOB_REGISTRY.name} registrieren und auf ${target.name} enqueuen.`,
      required_bridge_target: target.name,
      migration_strategy: [
        `1) job_type in ${JOB_REGISTRY.name} registrieren (lane, requires_package_id, is_governance).`,
        `2) Worker/Edge-Function auf ${target.name} hängen (kein neues Queue-System).`,
        '3) Stop-Condition / WIP-Cap definieren, Audit-Contract registrieren.',
      ],
    });
  }

  // NO_PARALLEL_SYSTEMS: neue Event-Tabelle parallel zu conversion_events
  if (
    (proposal.proposed_events ?? []).length > 0 ||
    (proposal.proposed_tables ?? []).some((t) => /conversion|funnel|tracking|events?$/i.test(t))
  ) {
    if (CONVERSION_SSOT) {
      findings.push({
        rule: 'NO_PARALLEL_SYSTEMS',
        severity: 'block',
        message: `Funnel-Event-SSOT existiert: ${CONVERSION_SSOT.name}.`,
        evidence: `proposed_events=${JSON.stringify(proposal.proposed_events ?? [])}, proposed_tables=${JSON.stringify(proposal.proposed_tables ?? [])} kollidieren mit ${CONVERSION_SSOT.name}.`,
        matched_known_systems: [CONVERSION_SSOT],
        recommended_reuse_path: `Neue event_type-Werte (z.B. ${(proposal.proposed_events ?? ['my_event'])[0]}) in ${CONVERSION_SSOT.name} schreiben; metadata-Schema erweitern statt neuer Tabelle.`,
        required_bridge_target: CONVERSION_SSOT.name,
        migration_strategy: [
          `1) event_type-Set in conversion_events erweitern.`,
          '2) metadata-Schema dokumentieren, package_id Generated Column nutzen.',
          '3) Reports/Guards an bestehende Views (v_conversion_*) anhängen.',
        ],
      });
    }
  }

  // SSOT_FIRST + EXTEND_EXISTING: starkes Reuse-Signal
  // Bridge-Intent: View/RPC mit ≥2 touches gilt als Bridge, nicht als Duplikat
  const isBridgeIntent =
    (proposal.kind === 'view' || proposal.kind === 'rpc') && (proposal.touches?.length ?? 0) >= 2;
  const ssotMatch = isBridgeIntent
    ? undefined
    : reuse.find(
        (s) => s.kind === proposal.kind || (s.kind === 'table' && proposal.kind === 'view'),
      );
  if (ssotMatch) {
    findings.push({
      rule: 'EXTEND_EXISTING',
      severity: 'block',
      message: `Bestehendes System "${ssotMatch.name}" (${ssotMatch.kind}) deckt diesen Zweck ab.`,
      evidence: `Reuse-Match auf Name/Tags/Purpose: "${ssotMatch.name}" (${ssotMatch.kind}) — ${ssotMatch.purpose}`,
      matched_known_systems: [ssotMatch],
      recommended_reuse_path: ssotMatch.extensionHint ?? `${ssotMatch.name} erweitern statt neu anlegen.`,
      required_bridge_target: ssotMatch.name,
      migration_strategy: [
        `1) Schema-Introspektion auf "${ssotMatch.name}".`,
        `2) Erweiterung als Spalte/Mode/Param-Variante an "${ssotMatch.name}".`,
        '3) Audit-Contract registrieren bzw. existierenden wiederverwenden.',
      ],
    });
    if (ssotMatch.tags.includes('registry') || ssotMatch.tags.includes('audit') || ssotMatch.tags.includes('queue')) {
      findings.push({
        rule: 'SSOT_FIRST',
        severity: 'block',
        message: `"${ssotMatch.name}" ist die SSOT für ${ssotMatch.tags.join(', ')}.`,
        evidence: `Tags der bestehenden SSOT: ${ssotMatch.tags.join(', ')} — Parallelsystem würde Plattform-Disziplin brechen.`,
        matched_known_systems: [ssotMatch],
        recommended_reuse_path: `Erweiterungspunkt in ${ssotMatch.name} nutzen; keine zweite SSOT für ${ssotMatch.tags[0]} eröffnen.`,
        required_bridge_target: ssotMatch.name,
      });
    }
  } else if (reuse.length > 0) {
    findings.push({
      rule: 'EXTEND_EXISTING',
      severity: 'warn',
      message: `${reuse.length} thematisch verwandte Systeme gefunden — Erweiterung prüfen.`,
      evidence: `Top-Reuse-Kandidaten: ${reuse.slice(0, 3).map((r) => r.name).join(', ')}`,
      matched_known_systems: reuse.slice(0, 3),
      recommended_reuse_path: reuse[0].extensionHint ?? `${reuse[0].name} als Erweiterungsbasis prüfen.`,
    });
  }

  // BRIDGE_DONT_FORK
  if (proposal.touches && proposal.touches.length >= 2 && bridge.length >= 2) {
    findings.push({
      rule: 'BRIDGE_DONT_FORK',
      severity: 'info',
      message: `Berührt ${proposal.touches.length} bestehende Systeme — bevorzuge View/Trigger/Adapter-RPC als Brücke.`,
      evidence: `touches=${JSON.stringify(proposal.touches)} → mögliche Brückenbauten zwischen ${bridge.slice(0, 3).map((b) => b.name).join(', ')}`,
      matched_known_systems: bridge.slice(0, 3),
      recommended_reuse_path: `View/Trigger/Adapter-RPC zwischen ${bridge.slice(0, 2).map((b) => b.name).join(' ↔ ')}.`,
    });
  }

  // GOVERNANCE_BEFORE_AUTOMATION
  const isAutomation = proposal.kind === 'cron' || proposal.kind === 'queue' || proposal.kind === 'edge_function';
  if (isAutomation) {
    if (!proposal.hasAuditContract) {
      findings.push({
        rule: 'GOVERNANCE_BEFORE_AUTOMATION',
        severity: 'block',
        message: 'Audit-Contract muss VOR Aktivierung der Automation registriert sein.',
        evidence: `proposal.hasAuditContract=false bei kind="${proposal.kind}"`,
        matched_known_systems: [AUDIT_REGISTRY].filter(Boolean),
        recommended_reuse_path: `INSERT INTO ${AUDIT_REGISTRY.name} (action_type, required_keys, …) vor Deploy.`,
      });
    }
    if (!proposal.hasStopCondition) {
      findings.push({
        rule: 'GOVERNANCE_BEFORE_AUTOMATION',
        severity: 'block',
        message: 'Stop-Condition / WIP-Cap / Cooldown fehlt.',
        evidence: 'proposal.hasStopCondition=false',
        matched_known_systems: [],
      });
    }
    if (!proposal.hasEligibilityGate) {
      findings.push({
        rule: 'GOVERNANCE_BEFORE_AUTOMATION',
        severity: 'warn',
        message: 'Eligibility-Gate (Funktion oder View) wird empfohlen.',
        evidence: 'proposal.hasEligibilityGate=false',
        matched_known_systems: [],
      });
    }
  }

  // NO_HIDDEN_STATE
  if (proposal.hasHiddenState) {
    findings.push({
      rule: 'NO_HIDDEN_STATE',
      severity: 'block',
      message: 'State darf nur in Tabellen leben — kein localStorage / Hardcoded-Liste / Memory.',
      evidence: 'proposal.hasHiddenState=true',
      matched_known_systems: [],
      recommended_reuse_path: 'State in einer existierenden Tabelle persistieren oder neue Tabelle mit RLS+Audit anlegen.',
    });
  }

  // AUDITABLE_MUTATIONS
  const writesData = proposal.kind === 'table' || proposal.kind === 'rpc' || proposal.kind === 'edge_function';
  if (writesData && !proposal.hasAuditContract) {
    findings.push({
      rule: 'AUDITABLE_MUTATIONS',
      severity: 'warn',
      message: 'Schreibende Operation ohne registrierten Audit-Contract.',
      evidence: `kind="${proposal.kind}" + hasAuditContract=false`,
      matched_known_systems: [AUDIT_SSOT, AUDIT_REGISTRY].filter(Boolean),
      recommended_reuse_path: `fn_emit_audit + ${AUDIT_REGISTRY.name}-Eintrag.`,
    });
  }

  // FAIL_VISIBLE
  if (/trigger|guard|silent|return null|catch/i.test(proposal.purpose) && !proposal.hasAuditContract) {
    findings.push({
      rule: 'FAIL_VISIBLE',
      severity: 'warn',
      message: 'Trigger/Guard ohne Audit-Mirror riskiert Silent-Drops.',
      evidence: `purpose enthält Guard-/Silent-Pattern ohne hasAuditContract.`,
      matched_known_systems: [AUDIT_SSOT].filter(Boolean),
      recommended_reuse_path: 'Audit-Mirror via fn_emit_audit nach Suppression einbauen.',
    });
  }

  // SECURITY_INHERITS
  if (proposal.kind === 'table' && proposal.rlsStatus !== 'on') {
    findings.push({
      rule: 'SECURITY_INHERITS',
      severity: 'block',
      message: 'Neue Tabelle ohne aktives RLS verboten.',
      evidence: `rlsStatus="${proposal.rlsStatus ?? 'undefined'}"`,
      matched_known_systems: [],
    });
  }
  if ((proposal.kind === 'rpc' || proposal.kind === 'view') && proposal.usesHasRole === false) {
    findings.push({
      rule: 'SECURITY_INHERITS',
      severity: 'warn',
      message: 'Admin-RPC/View ohne has_role()-Gate prüfen.',
      evidence: 'usesHasRole=false',
      matched_known_systems: [],
    });
  }

  // NO_AUTONOMOUS_PRODUCTION_WRITES
  if (proposal.writesProductionAutonomously) {
    findings.push({
      rule: 'NO_AUTONOMOUS_PRODUCTION_WRITES',
      severity: 'block',
      message: 'Autonome Production-Writes verboten. Accept/Reject-Schritt erforderlich.',
      evidence: 'proposal.writesProductionAutonomously=true',
      matched_known_systems: [],
    });
  }

  const duplication_risk = findings.filter((f) =>
    (['SSOT_FIRST', 'EXTEND_EXISTING', 'NO_PARALLEL_SYSTEMS', 'BRIDGE_DONT_FORK'] as ArchitectureRuleId[]).includes(f.rule),
  );
  const governance_risk = findings.filter((f) =>
    (
      [
        'GOVERNANCE_BEFORE_AUTOMATION',
        'AUDITABLE_MUTATIONS',
        'FAIL_VISIBLE',
        'SECURITY_INHERITS',
        'NO_AUTONOMOUS_PRODUCTION_WRITES',
        'NO_HIDDEN_STATE',
      ] as ArchitectureRuleId[]
    ).includes(f.rule),
  );

  // Verdichtete Migrationsstrategie
  const migration_strategy: string[] = [];
  for (const f of findings) {
    if (f.migration_strategy) migration_strategy.push(...f.migration_strategy);
  }
  const recommended_extension_points: string[] = [];
  for (const r of reuse.slice(0, 5)) {
    recommended_extension_points.push(
      r.extensionHint ? `${r.name}: ${r.extensionHint}` : `${r.name} (${r.kind}) — Erweiterung statt Neuanlage prüfen.`,
    );
  }
  if (bridge.length >= 2) {
    migration_strategy.push(
      `Bridge-Option: View/Trigger/Adapter zwischen ${bridge.slice(0, 3).map((b) => b.name).join(' ↔ ')} statt Fork.`,
    );
  }

  const hasBlock = findings.some((f) => f.severity === 'block');
  const hasWarn = findings.some((f) => f.severity === 'warn');
  const verdict: ArchitectureReview['verdict'] = hasBlock ? 'blocked' : hasWarn ? 'review_required' : 'approved';

  return {
    proposal,
    reuse_candidates: reuse,
    bridge_targets: bridge,
    findings,
    duplication_risk,
    governance_risk,
    migration_strategy,
    recommended_extension_points,
    verdict,
  };
}

export { ARCHITECTURE_RULES, RULE_BY_ID };
