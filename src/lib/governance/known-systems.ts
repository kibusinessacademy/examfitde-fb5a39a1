/**
 * Known-Systems-Registry — destillierte SSOT-Landkarte aus mem://index.
 *
 * Wird von architecture-review.ts genutzt, um Reuse-Kandidaten, Bridge-Targets
 * und Duplication-Risiken deterministisch zu erkennen, bevor neue Strukturen
 * angelegt werden.
 *
 * Pflege: bei jeder neuen SSOT-Etablierung (siehe Memory) hier ergänzen —
 * NIEMALS eine zweite Registry anlegen (NO_PARALLEL_SYSTEMS).
 */

export type SystemKind = 'table' | 'view' | 'rpc' | 'edge_function' | 'queue' | 'registry' | 'audit_log' | 'cron';

export interface KnownSystem {
  kind: SystemKind;
  name: string;
  /** Kurzbeschreibung des Zwecks – Schlüsselwörter für Heuristik-Match */
  purpose: string;
  /** Domain-Tags für Themen-Matching */
  tags: string[];
  /** Wie sollte erweitert werden statt dupliziert? */
  extensionHint?: string;
}

export const KNOWN_SYSTEMS: KnownSystem[] = [
  // ── Audit / Governance ─────────────────────────────────────────────
  {
    kind: 'audit_log',
    name: 'auto_heal_log',
    purpose: 'SSOT für Heal-/Repair-/Governance-Audit-Events. Schreibpfad NUR via fn_emit_audit.',
    tags: ['audit', 'heal', 'governance', 'log'],
    extensionHint: 'Neuen action_type in ops_audit_contract registrieren, dann fn_emit_audit nutzen.',
  },
  {
    kind: 'audit_log',
    name: 'ops_guardrail_events',
    purpose: 'SSOT für Guardrail-/Suppression-Events (Block/Defer/Skip).',
    tags: ['guardrail', 'block', 'suppression', 'audit'],
  },
  {
    kind: 'registry',
    name: 'ops_audit_contract',
    purpose: 'Registry für erlaubte action_types + required_keys. fn_emit_audit gated dagegen.',
    tags: ['registry', 'audit', 'contract'],
    extensionHint: 'INSERT INTO ops_audit_contract (action_type, required_keys, ...).',
  },
  {
    kind: 'registry',
    name: 'ops_job_type_registry',
    purpose: 'Registry für erlaubte job_types + lane + Pflichtfelder (requires_package_id, is_governance).',
    tags: ['registry', 'job', 'queue', 'contract'],
    extensionHint: 'Neuen job_type registrieren statt dynamisch zusammenbauen.',
  },

  // ── Queue / Runtime ────────────────────────────────────────────────
  {
    kind: 'queue',
    name: 'job_queue',
    purpose: 'SSOT für asynchrone Pipeline-Jobs. Lane-aware, mit BEFORE-INSERT-Guards.',
    tags: ['queue', 'job', 'pipeline', 'worker'],
    extensionHint: 'Neuen job_type via ops_job_type_registry, kein paralleles Queue-System bauen.',
  },
  {
    kind: 'queue',
    name: 'system_intents',
    purpose: 'SSOT für deklarative System-Intents (cron-getrieben, idempotent claim+dispatch).',
    tags: ['queue', 'intent', 'cron', 'system'],
  },
  {
    kind: 'queue',
    name: 'email_delivery_queue',
    purpose: 'SSOT für ausgehende E-Mails (Sequenzen + Transactional). Worker: email-sequence-worker.',
    tags: ['queue', 'email', 'sequence'],
  },
  {
    kind: 'queue',
    name: 'notification_events',
    purpose: 'SSOT für In-App/Push-Notifications mit Attribution + Recovery.',
    tags: ['queue', 'notification', 'push', 'inapp'],
  },

  // ── Marketing / Conversion ─────────────────────────────────────────
  {
    kind: 'table',
    name: 'conversion_events',
    purpose: 'SSOT für Funnel-Events (6 Pflicht-Events). package_id ist Generated Column.',
    tags: ['marketing', 'funnel', 'conversion', 'tracking'],
    extensionHint: 'Neue Events nur als event_type-Wert; metadata-Schema extend, nicht neue Tabelle.',
  },
  {
    kind: 'table',
    name: 'cta_winner_decisions',
    purpose: 'CTA-A/B-Auto-Promote-Entscheidungen pro page_path × cta_location.',
    tags: ['marketing', 'cta', 'ab_test'],
  },

  // ── Content / Pipeline ─────────────────────────────────────────────
  {
    kind: 'table',
    name: 'course_packages',
    purpose: 'SSOT für Lernpaket-Lifecycle (status, feature_flags, package_key immutable).',
    tags: ['content', 'package', 'lifecycle'],
    extensionHint: 'feature_flags JSONB für nicht-strukturelle Erweiterungen nutzen.',
  },
  {
    kind: 'table',
    name: 'exam_questions',
    purpose: 'SSOT für approved Exam-Items. v_hidden_hollow_ssot operiert ausschließlich darauf.',
    tags: ['content', 'questions', 'exam'],
  },
  {
    kind: 'table',
    name: 'learner_course_grants',
    purpose: 'SSOT für B2C-Zugriff post-paid. Idempotent via grant_learner_course_access.',
    tags: ['license', 'grant', 'access', 'b2c'],
  },
  {
    kind: 'table',
    name: 'entitlements',
    purpose: 'Bridge-SSOT zwischen Order und Feature-Flags (has_* Flags).',
    tags: ['license', 'entitlement', 'features'],
  },

  // ── SEO ────────────────────────────────────────────────────────────
  {
    kind: 'table',
    name: 'seo_content_priority_queue',
    purpose: 'SSOT für SEO-Wave-Enqueue (curriculum × competency × intent × persona).',
    tags: ['seo', 'queue', 'priority'],
  },
  {
    kind: 'rpc',
    name: 'admin_seo_wave_enqueue_one',
    purpose: 'Single-Row-Wave-Enqueue für SEO Intent-Pages. Multi-Row-INSERT verboten.',
    tags: ['seo', 'enqueue', 'wave'],
  },

  // ── User / Roles ───────────────────────────────────────────────────
  {
    kind: 'table',
    name: 'user_roles',
    purpose: 'SSOT für Rollen. Niemals in profiles speichern. Check via has_role().',
    tags: ['auth', 'roles', 'security'],
  },

  // ── Edge Functions (zentrale Gateways) ─────────────────────────────
  {
    kind: 'edge_function',
    name: 'ai-generation-gateway',
    purpose: 'Zentraler Entry-Point für alle AI-Generationen. Niemals Direct-AI-Call aus anderen Functions.',
    tags: ['ai', 'gateway', 'generation'],
    extensionHint: 'Neue Modi/Prompts dort registrieren, nicht parallele AI-Function bauen.',
  },
  {
    kind: 'edge_function',
    name: 'fn_emit_audit',
    purpose: 'Pflicht-Schreibpfad für auto_heal_log. Direct-INSERT ist ein Architektur-Bruch.',
    tags: ['audit', 'log'],
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
