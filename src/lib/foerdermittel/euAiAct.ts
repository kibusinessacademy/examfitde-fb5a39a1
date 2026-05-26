// FördermittelOS Cut 5 — EU AI Act Transparency SSOT
// Pure, deterministic. Derives AI-system disclosures from existing TrustOS / CoPilot registries.
// No new tables, no parallel registry — references existing Cut 4 (foerdermittel-copilot edge function)
// and the project-wide Lovable AI Gateway model contract.

export type AiActRiskTier = "minimal" | "limited" | "high" | "prohibited";

export type AiActPurpose =
  | "decision-support"
  | "content-summarization"
  | "classification"
  | "matching"
  | "translation"
  | "drafting";

export interface AiActSystem {
  id: string;
  /** Human-readable system name */
  name: string;
  /** Where this system is exposed in the product */
  surface: string;
  /** Underlying model (provider/model id from Lovable AI Gateway) */
  model: string;
  modelCategory: "LLM" | "Multimodal" | "Embedding" | "Heuristic";
  riskTier: AiActRiskTier;
  /** Purpose binding (Zweckbindung) per Art. 5 EU AI Act spirit */
  purposes: AiActPurpose[];
  /** Hard constraints — what this system MUST NOT do */
  prohibitedUses: string[];
  /** Human-oversight controls */
  humanOversight: string;
  /** Datenquellen (Grounding-Layer) */
  groundingSources: string[];
  /** Whether outputs are clearly labelled as AI-generated */
  outputDisclosure: string;
  /** TrustOS audit anchor — references existing memory contracts */
  trustOsAnchor: string;
}

/**
 * SSOT registry of AI-systems used in FördermittelOS.
 * Derived from existing Cut 4 (foerdermittel-copilot) + TrustOS audit-write contract.
 */
export const FOERDERMITTEL_AI_SYSTEMS: AiActSystem[] = [
  {
    id: "foerdermittel-copilot",
    name: "Fördermittel-CoPilot",
    surface: "/foerdermittel/programm/:slug — CopilotPanel",
    model: "google/gemini-2.5-flash (Lovable AI Gateway)",
    modelCategory: "LLM",
    riskTier: "limited",
    purposes: ["decision-support", "content-summarization", "drafting"],
    prohibitedUses: [
      "Automatisierte verbindliche Förderentscheidung",
      "Bewilligungsversprechen oder rechtsverbindliche Auskunft",
      "Bonitätsbewertung",
      "Verarbeitung personenbezogener Daten ohne Einwilligung",
    ],
    humanOversight:
      "Nutzer:innen sehen jede CoPilot-Ausgabe als Vorschlag. Anträge erfordern aktive Bestätigung und offizielle Quellprüfung.",
    groundingSources: [
      "Programm-Registry (Cut 1, lokal SSOT)",
      "Freshness-Snapshot (Cut 2)",
      "Execution-Roadmap (Cut 3)",
    ],
    outputDisclosure:
      "Alle CoPilot-Antworten tragen sichtbar 'AI-generierter Vorschlag · keine Rechtsberatung'. CoPilot-Inhalte werden via noindex von Such-Indexen ausgeschlossen.",
    trustOsAnchor:
      "mem://architektur/marketing/foerdermittel-os-cut4-copilot-v1 + mem://architektur/ops/audit-write-contract-v1",
  },
  {
    id: "foerdermittel-matching",
    name: "Matching-Engine",
    surface: "/foerdermittel — MatchingWizard",
    model: "deterministic / rule-based",
    modelCategory: "Heuristic",
    riskTier: "minimal",
    purposes: ["matching", "classification"],
    prohibitedUses: [
      "Auswahl-Diskriminierung nach geschützten Merkmalen",
      "Verwendung als alleiniges Entscheidungskriterium",
    ],
    humanOversight:
      "100% deterministisch + erklärbar. Jedes Match zeigt Reasons, Warnings, Disqualifier.",
    groundingSources: ["Programm-Registry"],
    outputDisclosure:
      "Matching-Resultate sind als Vorschlag gekennzeichnet — endgültige Förderfähigkeit bestätigt die Förderstelle.",
    trustOsAnchor: "mem://architektur/marketing/foerdermittel-os-v1",
  },
  {
    id: "foerdermittel-freshness",
    name: "Freshness Classifier",
    surface: "FörderRadar / Cluster-Pages",
    model: "deterministic / cadence-based",
    modelCategory: "Heuristic",
    riskTier: "minimal",
    purposes: ["classification"],
    prohibitedUses: ["Aussage über Bewilligungswahrscheinlichkeit"],
    humanOversight:
      "Status fresh/watch/stale/unknown wird transparent angezeigt. 'Quellenprüfung' bleibt menschliche Pflicht.",
    groundingSources: ["Quelldatums-Felder im Programm-Eintrag"],
    outputDisclosure:
      "Aktualitäts-Status ist sichtbar pro Programm; keine Fake-Aktualität.",
    trustOsAnchor: "mem://architektur/marketing/foerdermittel-os-cut2-freshness-v1",
  },
];

export interface AiActSummary {
  totalSystems: number;
  byRisk: Record<AiActRiskTier, number>;
  highestRisk: AiActRiskTier;
  hasProhibitedSystems: boolean;
}

export function summarizeAiAct(systems: AiActSystem[] = FOERDERMITTEL_AI_SYSTEMS): AiActSummary {
  const byRisk: Record<AiActRiskTier, number> = {
    minimal: 0,
    limited: 0,
    high: 0,
    prohibited: 0,
  };
  for (const s of systems) byRisk[s.riskTier] += 1;
  const order: AiActRiskTier[] = ["prohibited", "high", "limited", "minimal"];
  const highest = order.find((t) => byRisk[t] > 0) ?? "minimal";
  return {
    totalSystems: systems.length,
    byRisk,
    highestRisk: highest,
    hasProhibitedSystems: byRisk.prohibited > 0,
  };
}

export const RISK_TIER_LABEL: Record<AiActRiskTier, string> = {
  minimal: "Minimales Risiko",
  limited: "Begrenztes Risiko (Transparenzpflicht)",
  high: "Hochrisiko",
  prohibited: "Verboten",
};

export const PURPOSE_LABEL: Record<AiActPurpose, string> = {
  "decision-support": "Entscheidungsunterstützung",
  "content-summarization": "Inhaltszusammenfassung",
  classification: "Klassifikation",
  matching: "Matching",
  translation: "Übersetzung",
  drafting: "Textentwurf",
};
