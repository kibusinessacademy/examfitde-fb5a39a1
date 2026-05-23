/**
 * P19 — Growth Intelligence Layer (GIL) — Agent Contracts
 *
 * 6 typisierte Agent-Contracts. Pure types only. Kein DB-Zugriff, keine Side-Effects.
 * Bounded healing: Agenten produzieren NUR Insights/Briefings — keine autonomen
 * Code-/Schema-Mutationen, keine direkten Schreibzugriffe außerhalb der whitelisted RPCs.
 */

export type GilAgentKind =
  | 'product_intelligence'
  | 'marketing_intelligence'
  | 'seo_intelligence'
  | 'social_intelligence'
  | 'funnel_intelligence'
  | 'executive_director';

export type GilSeverity = 'info' | 'warning' | 'critical';

export interface GilAgentContract {
  /** Stable identifier; same as agent_kind in DB CHECK. */
  kind: GilAgentKind;
  /** Human-readable label for UI. */
  label: string;
  /** One-sentence mission. */
  mission: string;
  /** Allowed insight_type values this agent may emit. */
  allowedInsightTypes: readonly string[];
  /** Signal types this agent consumes. */
  consumesSignalTypes: readonly string[];
  /** Pillar(s) of the GOS framework this agent serves. */
  growthLayers: readonly string[];
  /** Whether agent may produce executive briefings (only CMO). */
  canProduceBriefings: boolean;
}

export const GIL_AGENT_CONTRACTS: Record<GilAgentKind, GilAgentContract> = {
  product_intelligence: {
    kind: 'product_intelligence',
    label: 'Product Intelligence',
    mission:
      'Beobachtet Produkt-Lücken, Feature-Drift und Lern-Outcome-Anomalien gegenüber Zielgruppe.',
    allowedInsightTypes: [
      'feature_gap_detected',
      'outcome_drift_detected',
      'pricing_signal_observed',
      'competitor_feature_added',
    ],
    consumesSignalTypes: [
      'competitor_release',
      'pricing_change',
      'review_signal',
      'product_telemetry',
    ],
    growthLayers: ['L1', 'L7'],
    canProduceBriefings: false,
  },
  marketing_intelligence: {
    kind: 'marketing_intelligence',
    label: 'Marketing Intelligence',
    mission: 'Erkennt Kampagnen-Druck, Persona-Drift und Messaging-Lücken im Markt.',
    allowedInsightTypes: [
      'campaign_pressure_observed',
      'message_gap_detected',
      'persona_demand_shift',
      'partnership_opportunity',
    ],
    consumesSignalTypes: ['ad_observed', 'campaign_change', 'press_mention'],
    growthLayers: ['L3', 'L6'],
    canProduceBriefings: false,
  },
  seo_intelligence: {
    kind: 'seo_intelligence',
    label: 'SEO Intelligence',
    mission:
      'Überwacht SERP-Bewegungen, Cluster-Risiken und Programmatic-SEO-Chancen — komplementär zur bestehenden SEO-Pipeline.',
    allowedInsightTypes: [
      'serp_drop_observed',
      'cannibalization_risk',
      'cluster_opportunity',
      'llm_visibility_change',
    ],
    consumesSignalTypes: ['serp_change', 'index_state_change', 'llm_query_result'],
    growthLayers: ['L4', 'L5'],
    canProduceBriefings: false,
  },
  social_intelligence: {
    kind: 'social_intelligence',
    label: 'Social Intelligence',
    mission: 'Analysiert Social-Pulse, Influencer-Bewegungen und virale Themen relevanter Personas.',
    allowedInsightTypes: [
      'trending_topic_detected',
      'influencer_signal',
      'community_concern',
      'viral_format_observed',
    ],
    consumesSignalTypes: ['social_post', 'engagement_metric', 'mention'],
    growthLayers: ['L3', 'L5'],
    canProduceBriefings: false,
  },
  funnel_intelligence: {
    kind: 'funnel_intelligence',
    label: 'Funnel Intelligence',
    mission: 'Liest Conversion-Funnel-Anomalien und Drop-offs gegen historische Baselines.',
    allowedInsightTypes: [
      'conversion_drop',
      'cta_underperformance',
      'cohort_anomaly',
      'checkout_friction',
    ],
    consumesSignalTypes: ['conversion_event', 'session_metric', 'experiment_result'],
    growthLayers: ['L6', 'L7'],
    canProduceBriefings: false,
  },
  executive_director: {
    kind: 'executive_director',
    label: 'Executive Director (CMO)',
    mission:
      'Synthese aller Agenten zu strategischen Briefings: Chancen, Risiken, priorisierte Empfehlungen — ohne Mutation, nur Empfehlung.',
    allowedInsightTypes: ['strategic_synthesis', 'priority_realignment'],
    consumesSignalTypes: [],
    growthLayers: ['L1', 'L3', 'L4', 'L5', 'L6', 'L7'],
    canProduceBriefings: true,
  },
};

export const GIL_AGENT_KINDS: readonly GilAgentKind[] = Object.keys(
  GIL_AGENT_CONTRACTS,
) as GilAgentKind[];

/**
 * Whitelist guard. Anything outside the contract is rejected.
 */
export function isInsightTypeAllowed(kind: GilAgentKind, insightType: string): boolean {
  const c = GIL_AGENT_CONTRACTS[kind];
  return !!c && c.allowedInsightTypes.includes(insightType);
}
