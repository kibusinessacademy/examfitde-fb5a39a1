/**
 * architecture-review — heuristische Architekturprüfung VOR neuen Strukturen.
 *
 * Erzwingt die 10 Prinzipien aus architecture-rules.ts auf jedes Vorhaben:
 *   reuse vor rebuild · bridge vor duplicate · extend vor replace · consistency vor speed.
 *
 * Output ist IMMER ein Vorschlag (NO_AUTONOMOUS_PRODUCTION_WRITES) — nichts
 * wird automatisch angelegt. Die Funktion ist deterministisch, läuft client-side
 * und schreibt nicht in die DB.
 */

import { ARCHITECTURE_RULES, type ArchitectureRuleId, RULE_BY_ID } from './architecture-rules';
import { findSystemsByKeyword, findSystemsByTags, type KnownSystem } from './known-systems';

export type ProposalKind = 'table' | 'view' | 'rpc' | 'edge_function' | 'queue' | 'registry' | 'cron' | 'audit_log';

export interface ArchitectureProposal {
  kind: ProposalKind;
  /** geplanter Name (z.B. table_name, function_name) */
  name: string;
  /** was soll das Ding tun? Plain-Text-Beschreibung */
  purpose: string;
  /** thematische Tags zur Match-Verbesserung (z.B. ['audit','heal'] oder ['marketing','funnel']) */
  tags?: string[];
  /** Tabellen/Funktionen, die berührt werden */
  touches?: string[];
  /** schreibt das Vorhaben direkt in Produktionsdaten ohne Accept/Review-Schritt? */
  writesProductionAutonomously?: boolean;
  /** wird ein Audit-Pfad eingerichtet/registriert? */
  hasAuditContract?: boolean;
  /** ist eine Stop-Condition / WIP-Cap / Cooldown definiert? */
  hasStopCondition?: boolean;
  /** wird Eligibility-Gate (RPC oder View) genutzt? */
  hasEligibilityGate?: boolean;
  /** RLS-Status: an / nicht-relevant / aus */
  rlsStatus?: 'on' | 'not_applicable' | 'off';
  /** wird Zugriff via has_role() gegated? */
  usesHasRole?: boolean;
  /** speichert das Vorhaben Status in localStorage / Memory / Hardcoded-Liste? */
  hasHiddenState?: boolean;
}

export type Severity = 'block' | 'warn' | 'info';

export interface RuleFinding {
  rule: ArchitectureRuleId;
  severity: Severity;
  message: string;
}

export interface ArchitectureReview {
  proposal: ArchitectureProposal;
  /** Reuse: bestehende Systeme, die der Vorschlag erweitern könnte */
  reuse_candidates: KnownSystem[];
  /** Bridge-Targets: Paare bestehender Systeme, zwischen denen eine Brücke statt Fork sinnvoller ist */
  bridge_targets: KnownSystem[];
  /** Findings pro Regel */
  findings: RuleFinding[];
  /** verdichtete Risiken */
  duplication_risk: RuleFinding[];
  governance_risk: RuleFinding[];
  /** empfohlene Migrationsstrategie als Free-Text-Liste */
  migration_strategy: string[];
  /** konkrete Erweiterungspunkte statt Neuanlage */
  recommended_extension_points: string[];
  /** Gesamt-Verdict */
  verdict: 'approved' | 'review_required' | 'blocked';
}

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
  const seen = new Set<string>();
  const out: KnownSystem[] = [];
  for (const s of [...byTags, ...byPurpose, ...byName]) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      out.push(s);
    }
  }
  return out.slice(0, 8);
}

function findBridgeTargets(p: ArchitectureProposal, reuse: KnownSystem[]): KnownSystem[] {
  if (!p.touches || p.touches.length < 2) return [];
  const matched: KnownSystem[] = [];
  for (const t of p.touches) {
    const hits = findSystemsByKeyword(t);
    matched.push(...hits.slice(0, 2));
  }
  // dedupe + bereits in reuse → bevorzugen, weil dort schon Reuse-Hint hängt
  const seen = new Set<string>();
  return [...reuse, ...matched].filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  }).slice(0, 6);
}

export function reviewArchitecture(proposal: ArchitectureProposal): ArchitectureReview {
  const findings: RuleFinding[] = [];
  const reuse = findReuseCandidates(proposal);
  const bridge = findBridgeTargets(proposal, reuse);

  // SSOT_FIRST + EXTEND_EXISTING: starkes Reuse-Signal → Block/Warn
  const ssotMatch = reuse.find(
    (s) => s.kind === proposal.kind || (s.kind === 'table' && proposal.kind === 'view'),
  );
  if (ssotMatch) {
    findings.push({
      rule: 'EXTEND_EXISTING',
      severity: 'block',
      message: `Bestehendes System "${ssotMatch.name}" (${ssotMatch.kind}) deckt diesen Zweck ab. ${ssotMatch.extensionHint ?? 'Erweitern statt neu anlegen.'}`,
    });
    if (ssotMatch.tags.includes('registry') || ssotMatch.tags.includes('audit') || ssotMatch.tags.includes('queue')) {
      findings.push({
        rule: 'SSOT_FIRST',
        severity: 'block',
        message: `"${ssotMatch.name}" ist die SSOT für ${ssotMatch.tags.join(', ')}. Ein zweites SSOT würde die Plattform-Disziplin brechen.`,
      });
    }
  } else if (reuse.length > 0) {
    findings.push({
      rule: 'EXTEND_EXISTING',
      severity: 'warn',
      message: `${reuse.length} thematisch verwandte Systeme gefunden — bitte prüfen, ob Erweiterung möglich ist.`,
    });
  }

  // NO_PARALLEL_SYSTEMS
  if (proposal.kind === 'queue' && reuse.some((s) => s.kind === 'queue')) {
    findings.push({
      rule: 'NO_PARALLEL_SYSTEMS',
      severity: 'block',
      message: 'Eine konkurrierende Queue-Struktur existiert bereits. Konsolidierung erforderlich.',
    });
  }
  if (proposal.kind === 'audit_log' && reuse.some((s) => s.kind === 'audit_log')) {
    findings.push({
      rule: 'NO_PARALLEL_SYSTEMS',
      severity: 'block',
      message: 'Audit-SSOT (auto_heal_log / ops_guardrail_events) existiert. fn_emit_audit nutzen, kein zweiter Audit-Stream.',
    });
  }

  // BRIDGE_DONT_FORK
  if (proposal.touches && proposal.touches.length >= 2 && bridge.length >= 2) {
    findings.push({
      rule: 'BRIDGE_DONT_FORK',
      severity: 'info',
      message: `Berührt ${proposal.touches.length} bestehende Systeme — bevorzuge View/Trigger/Adapter-RPC als Brücke.`,
    });
  }

  // GOVERNANCE_BEFORE_AUTOMATION
  const isAutomation = proposal.kind === 'cron' || proposal.kind === 'queue' || proposal.kind === 'edge_function';
  if (isAutomation) {
    if (!proposal.hasAuditContract) {
      findings.push({
        rule: 'GOVERNANCE_BEFORE_AUTOMATION',
        severity: 'block',
        message: 'Audit-Contract (ops_audit_contract) muss VOR Aktivierung der Automation registriert sein.',
      });
    }
    if (!proposal.hasStopCondition) {
      findings.push({
        rule: 'GOVERNANCE_BEFORE_AUTOMATION',
        severity: 'block',
        message: 'Stop-Condition / WIP-Cap / Cooldown fehlt.',
      });
    }
    if (!proposal.hasEligibilityGate) {
      findings.push({
        rule: 'GOVERNANCE_BEFORE_AUTOMATION',
        severity: 'warn',
        message: 'Eligibility-Gate (Funktion oder View) wird empfohlen.',
      });
    }
  }

  // NO_HIDDEN_STATE
  if (proposal.hasHiddenState) {
    findings.push({
      rule: 'NO_HIDDEN_STATE',
      severity: 'block',
      message: 'State darf nur in Tabellen leben — kein localStorage / Hardcoded-Liste / Memory.',
    });
  }

  // AUDITABLE_MUTATIONS
  const writesData = proposal.kind === 'table' || proposal.kind === 'rpc' || proposal.kind === 'edge_function';
  if (writesData && !proposal.hasAuditContract) {
    findings.push({
      rule: 'AUDITABLE_MUTATIONS',
      severity: 'warn',
      message: 'Schreibende Operation ohne registrierten Audit-Contract — fn_emit_audit + ops_audit_contract erforderlich.',
    });
  }

  // FAIL_VISIBLE — Heuristik: Trigger-/Guard-Erwähnung
  if (/trigger|guard|silent|return null|catch/i.test(proposal.purpose) && !proposal.hasAuditContract) {
    findings.push({
      rule: 'FAIL_VISIBLE',
      severity: 'warn',
      message: 'Trigger/Guard ohne Audit-Mirror riskiert Silent-Drops — Audit-Mirror einplanen.',
    });
  }

  // SECURITY_INHERITS
  if (proposal.kind === 'table' && proposal.rlsStatus !== 'on') {
    findings.push({
      rule: 'SECURITY_INHERITS',
      severity: 'block',
      message: 'Neue Tabelle ohne aktives RLS verboten.',
    });
  }
  if ((proposal.kind === 'rpc' || proposal.kind === 'view') && proposal.usesHasRole === false) {
    findings.push({
      rule: 'SECURITY_INHERITS',
      severity: 'warn',
      message: 'Admin-RPC/View ohne has_role()-Gate prüfen.',
    });
  }

  // NO_AUTONOMOUS_PRODUCTION_WRITES
  if (proposal.writesProductionAutonomously) {
    findings.push({
      rule: 'NO_AUTONOMOUS_PRODUCTION_WRITES',
      severity: 'block',
      message: 'Autonome Production-Writes sind verboten. Accept/Reject-Schritt zwischen Generation und Persistenz erforderlich.',
    });
  }

  const duplication_risk = findings.filter((f) =>
    (['SSOT_FIRST', 'EXTEND_EXISTING', 'NO_PARALLEL_SYSTEMS', 'BRIDGE_DONT_FORK'] as ArchitectureRuleId[]).includes(f.rule),
  );
  const governance_risk = findings.filter((f) =>
    (['GOVERNANCE_BEFORE_AUTOMATION', 'AUDITABLE_MUTATIONS', 'FAIL_VISIBLE', 'SECURITY_INHERITS', 'NO_AUTONOMOUS_PRODUCTION_WRITES', 'NO_HIDDEN_STATE'] as ArchitectureRuleId[]).includes(f.rule),
  );

  const migration_strategy: string[] = [];
  const recommended_extension_points: string[] = [];

  for (const r of reuse.slice(0, 5)) {
    if (r.extensionHint) {
      recommended_extension_points.push(`${r.name}: ${r.extensionHint}`);
    } else {
      recommended_extension_points.push(`${r.name} (${r.kind}) — Erweiterung statt Neuanlage prüfen.`);
    }
  }
  if (ssotMatch) {
    migration_strategy.push(`Schritt 1 — Schema-Introspektion auf "${ssotMatch.name}" (${ssotMatch.kind}).`);
    migration_strategy.push(`Schritt 2 — Erweiterung als Spalte/Mode/Param-Variante an "${ssotMatch.name}" entwerfen.`);
    migration_strategy.push('Schritt 3 — Audit-Contract registrieren bzw. existierenden wiederverwenden.');
    migration_strategy.push('Schritt 4 — Smoke-Test + Rollback-Hint + auto_heal_log-Eintrag in Migration aufnehmen.');
  }
  if (bridge.length >= 2) {
    migration_strategy.push(`Bridge-Option: View/Trigger/Adapter zwischen ${bridge.slice(0, 3).map((b) => b.name).join(' ↔ ')} statt Fork.`);
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
