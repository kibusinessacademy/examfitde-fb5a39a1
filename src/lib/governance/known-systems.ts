/**
 * Known-Systems-Registry — destillierte SSOT-Landkarte aus mem://index.
 *
 * v1.3: Erweitert um semantische Infrastruktur-Metadaten (ownership, neighbors,
 * healing_context, drift_context, event_contracts, audit_actions, domain).
 * Diese Felder sind die Grundlage für den Semantic Runtime Graph.
 *
 * Die Registry bleibt einziger SSOT — alle Felder optional für Rückwärtskompatibilität.
 *
 * Pflege: bei jeder neuen SSOT-Etablierung hier ergänzen — NIEMALS eine zweite
 * Registry anlegen (NO_PARALLEL_SYSTEMS). Spiegel-View v_known_systems_semantic_graph
 * ist read-only und wird via Migration aktualisiert.
 */

export type SystemKind = 'table' | 'view' | 'rpc' | 'edge_function' | 'queue' | 'registry' | 'audit_log' | 'cron';

export type SystemDomain =
  | 'governance'
  | 'queue'
  | 'audit'
  | 'marketing'
  | 'content'
  | 'seo'
  | 'security'
  | 'auth'
  | 'runtime'
  | 'license'
  | 'notification';

/**
 * Healability v1 — die fünf Qualitätsmerkmale eines heilbaren Systems.
 * Ein System mit Schreibpfad MUSS alle fünf erfüllen (HEALABILITY_IS_REQUIRED).
 */
export interface HealingContext {
  replayable: boolean;
  recoverable: boolean;
  auditable: boolean;
  observable: boolean;
  drift_detectable: boolean;
  /** optionaler Verweis auf Recovery-RPC / Reaper / Heal-Card */
  recovery_path?: string;
}

export interface DriftContext {
  /** View / RPC / Counter, der Drift sichtbar macht */
  drift_signal?: string;
  /** menschen-lesbare Drift-Bedingung */
  drift_when?: string;
}

export interface KnownSystem {
  kind: SystemKind;
  name: string;
  /** Kurzbeschreibung des Zwecks – Schlüsselwörter für Heuristik-Match */
  purpose: string;
  /** Domain-Tags für Themen-Matching */
  tags: string[];
  /** Wie sollte erweitert werden statt dupliziert? */
  extensionHint?: string;

  // ── v1.3 Semantische Metadaten (alle optional) ────────────────────
  /** primäre Domain */
  domain?: SystemDomain;
  /** verantwortliche Plattform-Schicht (z.B. 'platform-ops', 'marketing-loop-c') */
  ownership?: string;
  /** namentlich verbundene Systeme (gerichtete Kanten im Runtime-Graph) */
  neighbors?: string[];
  /** Healability-Profil — required für jedes System mit Mutationspfad */
  healing_context?: HealingContext;
  /** Drift-Erkennung */
  drift_context?: DriftContext;
  /** Event-Contracts: event_type / intent_key, die dieses System emittiert oder konsumiert */
  event_contracts?: string[];
  /** action_types, die dieses System nach auto_heal_log schreibt */
  audit_actions?: string[];
  /** Ist dieses System Plattform-Core, Erweiterung oder Helper? */
  governance_tier?: 'core' | 'extension' | 'helper';
}

const fullHealing: HealingContext = {
  replayable: true,
  recoverable: true,
  auditable: true,
  observable: true,
  drift_detectable: true,
};

export const KNOWN_SYSTEMS: KnownSystem[] = [
  // ── Audit / Governance ─────────────────────────────────────────────
  {
    kind: 'audit_log',
    name: 'auto_heal_log',
    purpose: 'SSOT für Heal-/Repair-/Governance-Audit-Events. Schreibpfad NUR via fn_emit_audit.',
    tags: ['audit', 'heal', 'governance', 'log'],
    extensionHint: 'Neuen action_type in ops_audit_contract registrieren, dann fn_emit_audit nutzen.',
    domain: 'audit',
    ownership: 'platform-ops',
    neighbors: ['ops_audit_contract', 'fn_emit_audit', 'ops_guardrail_events'],
    healing_context: { ...fullHealing, recovery_path: 'append-only; replay via SELECT, kein Recovery nötig' },
    drift_context: { drift_signal: 'v_auto_heal_log_identity_health', drift_when: 'target_type IS NULL OR action_type unregistered' },
    governance_tier: 'core',
  },
  {
    kind: 'audit_log',
    name: 'ops_guardrail_events',
    purpose: 'SSOT für Guardrail-/Suppression-Events (Block/Defer/Skip).',
    tags: ['guardrail', 'block', 'suppression', 'audit'],
    domain: 'audit',
    ownership: 'platform-ops',
    neighbors: ['auto_heal_log', 'job_queue'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
  {
    kind: 'registry',
    name: 'ops_audit_contract',
    purpose: 'Registry für erlaubte action_types + required_keys. fn_emit_audit gated dagegen.',
    tags: ['registry', 'audit', 'contract'],
    extensionHint: 'INSERT INTO ops_audit_contract (action_type, required_keys, ...).',
    domain: 'audit',
    ownership: 'platform-ops',
    neighbors: ['auto_heal_log', 'fn_emit_audit'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
  {
    kind: 'registry',
    name: 'ops_job_type_registry',
    purpose: 'Registry für erlaubte job_types + lane + Pflichtfelder (requires_package_id, is_governance).',
    tags: ['registry', 'job', 'queue', 'contract'],
    extensionHint: 'Neuen job_type registrieren statt dynamisch zusammenbauen.',
    domain: 'governance',
    ownership: 'platform-ops',
    neighbors: ['job_queue'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },

  // ── Queue / Runtime ────────────────────────────────────────────────
  {
    kind: 'queue',
    name: 'job_queue',
    purpose: 'SSOT für asynchrone Pipeline-Jobs. Lane-aware, mit BEFORE-INSERT-Guards.',
    tags: ['queue', 'job', 'pipeline', 'worker'],
    extensionHint: 'Neuen job_type via ops_job_type_registry, kein paralleles Queue-System bauen.',
    domain: 'queue',
    ownership: 'platform-ops',
    neighbors: ['ops_job_type_registry', 'auto_heal_log', 'ops_guardrail_events', 'system_intents'],
    healing_context: { ...fullHealing, recovery_path: 'claim_recovery_pulse + fn_reap_stale_processing_jobs' },
    drift_context: { drift_signal: 'v_ops_queue_claimability', drift_when: 'queued ohne aktiven Worker / stale processing' },
    audit_actions: ['job_queue_insert_suppressed_*', 'job_claimed', 'job_completed', 'job_failed'],
    governance_tier: 'core',
  },
  {
    kind: 'queue',
    name: 'system_intents',
    purpose: 'SSOT für deklarative System-Intents (cron-getrieben, idempotent claim+dispatch).',
    tags: ['queue', 'intent', 'cron', 'system'],
    domain: 'runtime',
    ownership: 'platform-ops',
    neighbors: ['job_queue', 'auto_heal_log'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
  {
    kind: 'queue',
    name: 'email_delivery_queue',
    purpose: 'SSOT für ausgehende E-Mails (Sequenzen + Transactional). Worker: email-sequence-worker.',
    tags: ['queue', 'email', 'sequence'],
    domain: 'marketing',
    ownership: 'marketing-loop-b',
    neighbors: ['conversion_events', 'auto_heal_log'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
  {
    kind: 'queue',
    name: 'notification_events',
    purpose: 'SSOT für In-App/Push-Notifications mit Attribution + Recovery.',
    tags: ['queue', 'notification', 'push', 'inapp'],
    domain: 'notification',
    ownership: 'marketing-loop-b',
    neighbors: ['notification_intent_registry', 'conversion_events', 'auto_heal_log'],
    event_contracts: ['delivered', 'opened', 'cta_clicked', 'goal_resolved'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },

  // ── Marketing / Conversion ─────────────────────────────────────────
  {
    kind: 'table',
    name: 'conversion_events',
    purpose: 'SSOT für Funnel-Events (6 Pflicht-Events). package_id ist Generated Column.',
    tags: ['marketing', 'funnel', 'conversion', 'tracking'],
    extensionHint: 'Neue Events nur als event_type-Wert; metadata-Schema extend, nicht neue Tabelle.',
    domain: 'marketing',
    ownership: 'marketing-loop-a',
    neighbors: ['cta_winner_decisions', 'email_delivery_queue', 'notification_events', 'learner_course_grants'],
    event_contracts: ['lead_quiz_started', 'lead_quiz_completed', 'cta_clicked', 'checkout_started', 'checkout_completed', 'tutor_session'],
    healing_context: { ...fullHealing, recovery_path: 'append-only events; replay via metadata' },
    governance_tier: 'core',
  },
  {
    kind: 'table',
    name: 'cta_winner_decisions',
    purpose: 'CTA-A/B-Auto-Promote-Entscheidungen pro page_path × cta_location.',
    tags: ['marketing', 'cta', 'ab_test'],
    domain: 'marketing',
    ownership: 'marketing-loop-a',
    neighbors: ['conversion_events'],
    healing_context: fullHealing,
    governance_tier: 'extension',
  },

  // ── Content / Pipeline ─────────────────────────────────────────────
  {
    kind: 'table',
    name: 'course_packages',
    purpose: 'SSOT für Lernpaket-Lifecycle (status, feature_flags, package_key immutable).',
    tags: ['content', 'package', 'lifecycle'],
    extensionHint: 'feature_flags JSONB für nicht-strukturelle Erweiterungen nutzen.',
    domain: 'content',
    ownership: 'content-pipeline',
    neighbors: ['exam_questions', 'job_queue', 'learner_course_grants'],
    healing_context: { ...fullHealing, recovery_path: 'admin_heal_*-RPCs + bronze_targeted_repair' },
    drift_context: { drift_signal: 'v_admin_heal_status_per_package', drift_when: 'building stuck / queued ohne job' },
    governance_tier: 'core',
  },
  {
    kind: 'table',
    name: 'exam_questions',
    purpose: 'SSOT für approved Exam-Items. v_hidden_hollow_ssot operiert ausschließlich darauf.',
    tags: ['content', 'questions', 'exam'],
    domain: 'content',
    ownership: 'content-pipeline',
    neighbors: ['course_packages'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
  {
    kind: 'table',
    name: 'learner_course_grants',
    purpose: 'SSOT für B2C-Zugriff post-paid. Idempotent via grant_learner_course_access.',
    tags: ['license', 'grant', 'access', 'b2c'],
    domain: 'license',
    ownership: 'marketing-loop-c',
    neighbors: ['entitlements', 'conversion_events', 'course_packages'],
    healing_context: { ...fullHealing, recovery_path: 'admin_repair_paid_orders_without_grant' },
    drift_context: { drift_signal: 'fn_launch_orders_health', drift_when: 'paid_no_grant > 0' },
    governance_tier: 'core',
  },
  {
    kind: 'table',
    name: 'entitlements',
    purpose: 'Bridge-SSOT zwischen Order und Feature-Flags (has_* Flags).',
    tags: ['license', 'entitlement', 'features'],
    domain: 'license',
    ownership: 'marketing-loop-c',
    neighbors: ['learner_course_grants'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },

  // ── SEO ────────────────────────────────────────────────────────────
  {
    kind: 'table',
    name: 'seo_content_priority_queue',
    purpose: 'SSOT für SEO-Wave-Enqueue (curriculum × competency × intent × persona).',
    tags: ['seo', 'queue', 'priority'],
    domain: 'seo',
    ownership: 'seo-knowledge-os',
    neighbors: ['job_queue', 'admin_seo_wave_enqueue_one'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
  {
    kind: 'rpc',
    name: 'admin_seo_wave_enqueue_one',
    purpose: 'Single-Row-Wave-Enqueue für SEO Intent-Pages. Multi-Row-INSERT verboten.',
    tags: ['seo', 'enqueue', 'wave'],
    domain: 'seo',
    ownership: 'seo-knowledge-os',
    neighbors: ['seo_content_priority_queue', 'job_queue', 'auto_heal_log'],
    audit_actions: ['seo_wave_enqueue_attempt'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
  {
    kind: 'view',
    name: 'v_seo_content_node_ssot',
    purpose: 'Read-only Node-SSOT für 7 SEO-Content-Quellen (Bridge, kein zweites SSOT).',
    tags: ['seo', 'content', 'node', 'bridge'],
    domain: 'seo',
    ownership: 'seo-knowledge-os',
    neighbors: ['seo_documents', 'blog_articles', 'certification_seo_pages', 'seo_refresh_queue'],
    healing_context: fullHealing,
    governance_tier: 'extension',
  },
  {
    kind: 'queue',
    name: 'seo_refresh_queue',
    purpose: 'Bestehende Refresh-Queue, gefüttert durch deterministischen Producer auf v_seo_content_node_ssot.',
    tags: ['seo', 'queue', 'refresh'],
    domain: 'seo',
    ownership: 'seo-knowledge-os',
    neighbors: ['v_seo_content_node_ssot', 'auto_heal_log'],
    audit_actions: ['seo_refresh_queue_producer_run'],
    healing_context: fullHealing,
    governance_tier: 'extension',
  },

  // ── User / Roles ───────────────────────────────────────────────────
  {
    kind: 'table',
    name: 'user_roles',
    purpose: 'SSOT für Rollen. Niemals in profiles speichern. Check via has_role().',
    tags: ['auth', 'roles', 'security'],
    domain: 'auth',
    ownership: 'platform-ops',
    healing_context: fullHealing,
    governance_tier: 'core',
  },

  // ── Edge Functions (zentrale Gateways) ─────────────────────────────
  {
    kind: 'edge_function',
    name: 'ai-generation-gateway',
    purpose: 'Zentraler Entry-Point für alle AI-Generationen. Niemals Direct-AI-Call aus anderen Functions.',
    tags: ['ai', 'gateway', 'generation'],
    extensionHint: 'Neue Modi/Prompts dort registrieren, nicht parallele AI-Function bauen.',
    domain: 'runtime',
    ownership: 'platform-ops',
    neighbors: ['auto_heal_log', 'job_queue'],
    healing_context: { ...fullHealing, recovery_path: 'job_queue retry; rate-limit via lane' },
    governance_tier: 'core',
  },
  {
    kind: 'edge_function',
    name: 'fn_emit_audit',
    purpose: 'Pflicht-Schreibpfad für auto_heal_log. Direct-INSERT ist ein Architektur-Bruch.',
    tags: ['audit', 'log'],
    domain: 'audit',
    ownership: 'platform-ops',
    neighbors: ['auto_heal_log', 'ops_audit_contract'],
    healing_context: fullHealing,
    governance_tier: 'core',
  },
];

const TAG_INDEX = (() => {
  const idx = new Map<string, KnownSystem[]>();
  for (const sys of KNOWN_SYSTEMS) {
    for (const tag of sys.tags) {
      if (!idx.has(tag)) idx.set(tag, []);
      idx.get(tag)!.push(sys);
    }
  }
  return idx;
})();

export function findSystemsByTags(tags: string[]): KnownSystem[] {
  const seen = new Set<string>();
  const out: KnownSystem[] = [];
  for (const tag of tags) {
    for (const sys of TAG_INDEX.get(tag.toLowerCase()) ?? []) {
      if (!seen.has(sys.name)) {
        seen.add(sys.name);
        out.push(sys);
      }
    }
  }
  return out;
}

export function findSystemsByKeyword(text: string): KnownSystem[] {
  const lower = text.toLowerCase();
  return KNOWN_SYSTEMS.filter(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      s.purpose.toLowerCase().includes(lower) ||
      s.tags.some((t) => lower.includes(t)),
  );
}

export function findSystemByName(name: string): KnownSystem | undefined {
  return KNOWN_SYSTEMS.find((s) => s.name === name);
}

/**
 * Healability-Score: 0..5. Ein System ohne healing_context zählt als 0.
 */
export function healabilityScore(sys: KnownSystem): number {
  const h = sys.healing_context;
  if (!h) return 0;
  return (
    (h.replayable ? 1 : 0) +
    (h.recoverable ? 1 : 0) +
    (h.auditable ? 1 : 0) +
    (h.observable ? 1 : 0) +
    (h.drift_detectable ? 1 : 0)
  );
}
