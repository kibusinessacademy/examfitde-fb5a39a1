/**
 * BerufOS Smart Setup Recommendations — Pure deterministic engine.
 *
 * SSOT-Contract:
 *  - Reads ONLY from existing admin_* signal RPCs (no new tables).
 *  - Produces structured Recommendations with evidence + deep-links.
 *  - No AI, no probabilistic ranking — pure threshold logic.
 *  - Auto-fix flag is INFORMATIONAL: it links into existing healers/wizards.
 */

export type RecCategory =
  | "activation"
  | "learning"
  | "curriculum"
  | "growth"
  | "governance"
  | "ai";

export type RecSeverity = "info" | "warning" | "critical";

export interface Recommendation {
  id: string;
  category: RecCategory;
  severity: RecSeverity;
  title: string;
  description: string;
  /** 1–100, higher = more business impact. */
  impact_score: number;
  /** 1–100, higher = more effort to address. */
  effort_score: number;
  recommended_action?: string;
  auto_fix_available: boolean;
  /** Where the operator goes to act. */
  deep_link?: string;
  evidence: {
    source: string;
    count?: number;
    ids?: string[];
  };
}

/** Raw signal envelope feeding the engine. Each field may be null when its RPC is unauthorized or empty. */
export interface RecSignals {
  wizards?: {
    total: number;
    connected: number;
    in_progress: number;
    error: number;
    by_key: Record<string, "not_started" | "in_progress" | "connected" | "error" | "skipped">;
  } | null;
  customer_safe?: {
    customer_safe: number;
    not_ready: number;
    total: number;
    blockers_by_reason?: Array<{ reason: string; count: number }>;
  } | null;
  data_holes?: {
    total: number;
    by_kind?: Array<{ kind: string; count: number }>;
  } | null;
  commerce_gap?: {
    published_without_price: number;
    published_without_landing: number;
    total_published: number;
  } | null;
  empty_courses?: { count: number } | null;
  content_sellability?: {
    ready: number;
    blocked: number;
    total: number;
  } | null;
  graph?: {
    skills: number;
    competencies: number;
    workflows: number;
    outcomes: number;
    recoveries: number;
  } | null;
  heal_alerts?: {
    open: number;
    critical: number;
  } | null;
  ai_observability?: {
    tutor_no_evidence: number;
    failed_24h: number;
    avg_cost_per_call: number | null;
  } | null;
  lane_health?: {
    stuck_processing: number;
    pending: number;
    failed_15m: number;
  } | null;
}

const rec = (r: Recommendation): Recommendation => r;

export function buildRecommendations(s: RecSignals): Recommendation[] {
  const out: Recommendation[] = [];

  // ───────── Activation / Wizards ─────────
  if (s.wizards) {
    const { total, connected, error } = s.wizards;
    const ratio = total > 0 ? connected / total : 0;
    if (error > 0) {
      out.push(rec({
        id: "wizards.errors",
        category: "activation", severity: "critical",
        title: `${error} Setup-Wizards melden Fehler`,
        description: "Eine oder mehrere Integrationen sind im Fehlerzustand. Re-Authentifizierung oder Korrektur empfohlen.",
        impact_score: 85, effort_score: 30,
        recommended_action: "Wizards öffnen und Fehler beheben",
        auto_fix_available: false,
        deep_link: "/admin/setup-wizards",
        evidence: { source: "enterprise_setup_wizard_state", count: error },
      }));
    }
    if (ratio < 0.4 && total > 0) {
      out.push(rec({
        id: "wizards.low_activation",
        category: "activation", severity: ratio < 0.2 ? "warning" : "info",
        title: `Aktivierungsgrad ${Math.round(ratio * 100)} %`,
        description: `Nur ${connected} von ${total} Integrationen sind verbunden. Höhere Aktivierung = stärkerer Lock-in.`,
        impact_score: 70, effort_score: 40,
        recommended_action: "Wichtigste Wizards (SSO, Stripe, AI Provider, GTM) priorisieren",
        auto_fix_available: false,
        deep_link: "/admin/setup-wizards",
        evidence: { source: "enterprise_setup_wizard_state", count: total - connected },
      }));
    }
    // Specific high-value blockers
    const must = ["sso_saml_oidc", "stripe_billing", "lovable_ai_gateway", "ga4_gtm"];
    must.forEach((k) => {
      const st = s.wizards!.by_key[k];
      if (!st || st === "not_started") {
        out.push(rec({
          id: `wizards.missing.${k}`,
          category: "activation", severity: "warning",
          title: `Pflicht-Integration fehlt: ${k}`,
          description: "Diese Integration ist Voraussetzung für eine vollständig produktive Plattform.",
          impact_score: 75, effort_score: 25,
          auto_fix_available: false,
          deep_link: "/admin/setup-wizards",
          evidence: { source: "wizard_catalog", ids: [k] },
        }));
      }
    });
  }

  // ───────── Curriculum / Learning ─────────
  if (s.customer_safe) {
    const { not_ready, total } = s.customer_safe;
    if (not_ready > 0) {
      const ratio = total > 0 ? not_ready / total : 0;
      out.push(rec({
        id: "learning.not_customer_safe",
        category: "learning",
        severity: ratio > 0.3 ? "critical" : "warning",
        title: `${not_ready} Pakete nicht customer-safe`,
        description: "Pakete erfüllen die Lieferbedingungen (Lessons, Pricing, Entitlement) noch nicht.",
        impact_score: 90, effort_score: 50,
        recommended_action: "Heal-Cockpit öffnen und Repair-Wellen starten",
        auto_fix_available: true,
        deep_link: "/admin/heal",
        evidence: { source: "v_package_customer_safe_v1", count: not_ready },
      }));
    }
  }
  if (s.data_holes && s.data_holes.total > 0) {
    out.push(rec({
      id: "curriculum.data_holes",
      category: "curriculum",
      severity: s.data_holes.total > 500 ? "critical" : "warning",
      title: `${s.data_holes.total} Datenlücken im Curriculum-SSOT`,
      description: "Fehlende Lessons, Fragen, Blueprints oder Tutor-Kontexte erkannt.",
      impact_score: 80, effort_score: 60,
      auto_fix_available: true,
      deep_link: "/admin/heal",
      evidence: {
        source: "v_data_holes_ssot",
        count: s.data_holes.total,
        ids: (s.data_holes.by_kind || []).slice(0, 5).map((b) => `${b.kind}:${b.count}`),
      },
    }));
  }
  if (s.empty_courses && s.empty_courses.count > 0) {
    out.push(rec({
      id: "curriculum.empty_published",
      category: "curriculum", severity: "critical",
      title: `${s.empty_courses.count} veröffentlichte Kurse ohne Inhalt`,
      description: "Sichtbar für Kunden, aber inhaltlich leer — sofortiger Reputations- und Conversion-Schaden.",
      impact_score: 95, effort_score: 30,
      auto_fix_available: true,
      deep_link: "/admin/heal",
      evidence: { source: "admin_get_empty_published_courses", count: s.empty_courses.count },
    }));
  }

  // ───────── Growth / Commerce ─────────
  if (s.commerce_gap) {
    const g = s.commerce_gap;
    if (g.published_without_price > 0) {
      out.push(rec({
        id: "growth.no_price",
        category: "growth", severity: "critical",
        title: `${g.published_without_price} Pakete ohne aktiven Preis`,
        description: "Veröffentlichte Pakete ohne Stripe-Price sind nicht kaufbar.",
        impact_score: 95, effort_score: 20,
        auto_fix_available: false,
        deep_link: "/admin/commerce",
        evidence: { source: "admin_get_commerce_gap_summary", count: g.published_without_price },
      }));
    }
    if (g.published_without_landing > 0) {
      out.push(rec({
        id: "growth.no_landing",
        category: "growth", severity: "warning",
        title: `${g.published_without_landing} Pakete ohne Landingpage`,
        description: "Ohne Landingpage keine SEO-Distribution und keine Paid-Funnel-Zielseite.",
        impact_score: 70, effort_score: 45,
        auto_fix_available: true,
        deep_link: "/admin/growth",
        evidence: { source: "admin_get_commerce_gap_summary", count: g.published_without_landing },
      }));
    }
  }

  // ───────── Governance / AI ─────────
  if (s.heal_alerts && s.heal_alerts.open > 0) {
    out.push(rec({
      id: "governance.heal_alerts",
      category: "governance",
      severity: s.heal_alerts.critical > 0 ? "critical" : "warning",
      title: `${s.heal_alerts.open} offene Heal-Alerts (${s.heal_alerts.critical} kritisch)`,
      description: "Plattform-Selbstheilung meldet offene Pattern. Cockpit prüfen.",
      impact_score: 80, effort_score: 25,
      auto_fix_available: true,
      deep_link: "/admin/heal",
      evidence: { source: "auto_heal_log + heal_alert_notifications", count: s.heal_alerts.open },
    }));
  }
  if (s.ai_observability && s.ai_observability.tutor_no_evidence > 0) {
    out.push(rec({
      id: "ai.tutor_no_evidence",
      category: "ai", severity: "warning",
      title: `${s.ai_observability.tutor_no_evidence} Tutor-Antworten ohne Graph-Evidenz`,
      description: "Strict-RAG-Verstöße. Graph-Activation prüfen oder Refusal-Phrase erzwingen.",
      impact_score: 75, effort_score: 35,
      auto_fix_available: false,
      deep_link: "/berufs-ki/graph-activation",
      evidence: { source: "ai_tutor_audit", count: s.ai_observability.tutor_no_evidence },
    }));
  }
  if (s.lane_health) {
    if (s.lane_health.stuck_processing > 0) {
      out.push(rec({
        id: "governance.stuck_jobs",
        category: "governance",
        severity: s.lane_health.stuck_processing > 20 ? "critical" : "warning",
        title: `${s.lane_health.stuck_processing} hängende Jobs in der Pipeline`,
        description: "Stale processing-Jobs blockieren Worker-Slots — Reaper greift erst nach Stale-Window.",
        impact_score: 70, effort_score: 15,
        recommended_action: "Manueller Reap oder Recovery-Pulse",
        auto_fix_available: true,
        deep_link: "/admin/heal/queue",
        evidence: { source: "v_ops_queue_claimability", count: s.lane_health.stuck_processing },
      }));
    }
  }
  if (s.graph) {
    const minLayer = Math.min(s.graph.skills, s.graph.competencies, s.graph.workflows, s.graph.outcomes);
    if (minLayer < 20) {
      out.push(rec({
        id: "ai.graph_sparse",
        category: "ai", severity: "info",
        title: "Intelligence Graph noch dünn besetzt",
        description: `Mindestens eine Graph-Schicht hat < 20 Knoten (Min: ${minLayer}). Tutor- und Workflow-Empfehlungen sind dadurch limitiert.`,
        impact_score: 60, effort_score: 70,
        auto_fix_available: false,
        deep_link: "/admin/berufs-ki/graph",
        evidence: { source: "berufs_ki_graph_*", count: minLayer },
      }));
    }
  }

  // Sort: critical > warning > info, then impact desc
  const sevOrder: Record<RecSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) =>
    sevOrder[a.severity] - sevOrder[b.severity] || b.impact_score - a.impact_score
  );
}

export function severityClass(s: RecSeverity): string {
  switch (s) {
    case "critical": return "bg-status-error-bg-subtle text-status-error-text border-status-error-border";
    case "warning":  return "bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border";
    default:         return "bg-status-info-bg-subtle text-status-info-text border-status-info-border";
  }
}

export function categoryLabel(c: RecCategory): string {
  return {
    activation: "Aktivierung",
    learning: "Lernsystem",
    curriculum: "Curriculum",
    growth: "Growth & Commerce",
    governance: "Governance",
    ai: "AI Operations",
  }[c];
}
