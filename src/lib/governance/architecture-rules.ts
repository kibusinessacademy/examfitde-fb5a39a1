/**
 * Architectural Continuity Guard — SSOT für plattformweite Architekturregeln.
 *
 * Diese 10 Prinzipien sind die feste Leitregel für alle Erweiterungen:
 *   reuse vor rebuild · bridge vor duplicate · extend vor replace · consistency vor speed.
 *
 * Quelle der Wahrheit: dieses Modul. Andere Stellen importieren — niemals duplizieren.
 */

export type RuleSeverity = 'hard' | 'soft';

export interface ArchitectureRule {
  id: string;
  name: string;
  description: string;
  severity: RuleSeverity;
  /** Was prüft die Architektur-Review konkret? */
  checks: string[];
}

export const ARCHITECTURE_RULES: ArchitectureRule[] = [
  {
    id: 'SSOT_FIRST',
    name: 'SSOT zuerst',
    description:
      'Jede Entität, Metrik, Status-Definition oder Lebenszyklus-Stufe darf nur EINE Single Source of Truth haben. Neue Tabellen/Views/Felder müssen die bestehende SSOT erweitern, nicht parallelisieren.',
    severity: 'hard',
    checks: [
      'existiert bereits eine SSOT-Tabelle/View für diese Domäne?',
      'entstünde durch das Vorhaben ein zweites SSOT?',
    ],
  },
  {
    id: 'EXTEND_EXISTING',
    name: 'Bestehendes erweitern',
    description:
      'Vor dem Erstellen neuer Strukturen MUSS geprüft werden, ob bestehende Tabellen, RPCs, Edge Functions, UI-Karten oder Cron-Jobs erweitert werden können. Ergänzen vor Neuanlegen.',
    severity: 'hard',
    checks: [
      'gibt es eine bestehende Tabelle/RPC/Edge-Function mit gleichem Zweck?',
      'kann das Feature durch eine neue Spalte/Mode/Param-Variante abgebildet werden?',
    ],
  },
  {
    id: 'NO_PARALLEL_SYSTEMS',
    name: 'Keine Parallelsysteme',
    description:
      'Zwei Systeme, die denselben Job tun, sind verboten. Konkurrierende Queues, Worker, Audit-Logs oder Registries sind ein Architektur-Bruch.',
    severity: 'hard',
    checks: [
      'existiert bereits eine Queue/Worker/Registry, die den gleichen Flow bedient?',
      'entstehen konkurrierende Schreibpfade auf dieselben Daten?',
    ],
  },
  {
    id: 'BRIDGE_DONT_FORK',
    name: 'Brücke statt Fork',
    description:
      'Wenn zwei bestehende Systeme zusammenwirken sollen, baue eine Brücke (View, Generated Column, Trigger, Adapter-RPC) — niemals einen Fork mit eigener Logik.',
    severity: 'hard',
    checks: [
      'lässt sich das Vorhaben als Bridge-View/Trigger/Adapter umsetzen?',
      'wird stattdessen Logik dupliziert?',
    ],
  },
  {
    id: 'GOVERNANCE_BEFORE_AUTOMATION',
    name: 'Governance vor Automation',
    description:
      'Neue Automatisierungen (Cron, Worker, Auto-Heal, Auto-Promote) sind nur erlaubt, wenn Audit-Contract, Stop-Condition und Eligibility-Gate VORHER definiert sind.',
    severity: 'hard',
    checks: [
      'ist ein Audit-Contract (ops_audit_contract) registriert?',
      'gibt es eine dokumentierte Stop-Condition / WIP-Cap / Cooldown?',
      'existiert ein Eligibility-Gate (Funktion oder View)?',
    ],
  },
  {
    id: 'NO_HIDDEN_STATE',
    name: 'Kein verborgener State',
    description:
      'State darf nur in Tabellen leben — niemals in localStorage, sessionStorage, Edge-Function-Memory, Code-Konstanten oder Hardcoded-Listen.',
    severity: 'hard',
    checks: [
      'wird Status/Berechtigung clientseitig gespeichert?',
      'gibt es Hardcoded-Listen, die DB-Daten widerspiegeln?',
    ],
  },
  {
    id: 'AUDITABLE_MUTATIONS',
    name: 'Auditierbare Mutationen',
    description:
      'Jede schreibende Operation auf Produktionsdaten MUSS via fn_emit_audit in auto_heal_log mit registriertem action_type protokolliert werden.',
    severity: 'hard',
    checks: [
      'wird jede Mutation via fn_emit_audit geloggt?',
      'ist der action_type in ops_audit_contract registriert?',
      'wird ein bestehender Audit-Pfad umgangen?',
    ],
  },
  {
    id: 'FAIL_VISIBLE',
    name: 'Sichtbar scheitern',
    description:
      'Fehler dürfen nicht still verschluckt werden. Silent-Drops (Trigger RETURN NULL, leere catches, suppressed exceptions) brauchen Audit-Mirror und Alarm-Pfad.',
    severity: 'hard',
    checks: [
      'gibt es Silent-Drop-Pfade ohne Audit-Mirror?',
      'sind Fehler in einer Heal-Cockpit-Card sichtbar?',
    ],
  },
  {
    id: 'SECURITY_INHERITS',
    name: 'Security wird vererbt',
    description:
      'Neue Tabellen/Views/RPCs erben das Sicherheitsmodell der Domäne: RLS an, Admin-Views nicht an authenticated granted, Roles via has_role(), niemals Client-side-Admin-Checks.',
    severity: 'hard',
    checks: [
      'ist RLS aktiviert?',
      'wird der Zugriff via SECURITY DEFINER + has_role() gegated?',
      'gibt es einen Client-side-Admin-Check?',
    ],
  },
  {
    id: 'NO_AUTONOMOUS_PRODUCTION_WRITES',
    name: 'Keine autonomen Production-Writes',
    description:
      'KI-, Scaffold- und Auto-Generate-Pfade dürfen NIEMALS direkt in Produktion schreiben. Output ist immer ein Vorschlag, der von Mensch oder registriertem Governance-Gate freigegeben wird.',
    severity: 'hard',
    checks: [
      'schreibt ein KI-/Auto-Pfad direkt in Produktion?',
      'gibt es einen Accept/Reject-Schritt vor dem Write?',
    ],
  },
];

export const RULE_BY_ID: Readonly<Record<string, ArchitectureRule>> = Object.freeze(
  Object.fromEntries(ARCHITECTURE_RULES.map((r) => [r.id, r])),
);

export type ArchitectureRuleId = (typeof ARCHITECTURE_RULES)[number]['id'];
