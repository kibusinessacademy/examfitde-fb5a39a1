/**
 * W1 Cut 2 — Trust Layer SSOT.
 *
 * Trust signals are deterministic, content-addressable, and rendered
 * via <TrustLayerStrip />. Never inline trust copy in components.
 */

export const TRUST_SIGNAL_KINDS = [
  "rahmenplan_basiert",
  "pruefungsnah",
  "echte_pruefungslogik",
  "explainable_ai",
  "tutor_strict_rag",
  "keine_halluzination",
  "kompetenzbasiert",
  "simulation_realistisch",
  "lernfortschritt_nachvollziehbar",
  "transparente_bewertung",
] as const;

export type TrustSignalKind = (typeof TRUST_SIGNAL_KINDS)[number];

export interface TrustSignal {
  kind: TrustSignalKind;
  label: string;
  detail: string;
}

const REGISTRY: Readonly<Record<TrustSignalKind, TrustSignal>> = {
  rahmenplan_basiert: {
    kind: "rahmenplan_basiert",
    label: "IHK-Rahmenplan-basiert",
    detail: "Inhalte 1:1 an Prüfungsbereiche gemappt — keine erfundenen Themen.",
  },
  pruefungsnah: {
    kind: "pruefungsnah",
    label: "Prüfungsnah trainieren",
    detail: "Aufgaben, Sprache und Bewertung folgen echten IHK-Mustern.",
  },
  echte_pruefungslogik: {
    kind: "echte_pruefungslogik",
    label: "Echte Prüfungslogik",
    detail: "Bewertung nach prüfungsnaher Logik, nicht nach Zufallspunkten.",
  },
  explainable_ai: {
    kind: "explainable_ai",
    label: "Erklärbare KI",
    detail: "Jede Bewertung verweist auf die Kompetenz, aus der sie stammt.",
  },
  tutor_strict_rag: {
    kind: "tutor_strict_rag",
    label: "Strict-RAG Tutor",
    detail: "Antworten nur aus Kurs- und Rahmenplan-Quellen, mit Quellenangabe.",
  },
  keine_halluzination: {
    kind: "keine_halluzination",
    label: "Keine erfundenen KI-Antworten",
    detail: "Wenn die Quelle fehlt, sagt der Tutor das — statt zu raten.",
  },
  kompetenzbasiert: {
    kind: "kompetenzbasiert",
    label: "Kompetenzbasiert",
    detail: "Fortschritt pro Kompetenz, nicht pro Kapitel oder Klick.",
  },
  simulation_realistisch: {
    kind: "simulation_realistisch",
    label: "Realistische Simulation",
    detail: "Echte Prüfungsbedingungen — Zeit, Format, Bewertungsraster.",
  },
  lernfortschritt_nachvollziehbar: {
    kind: "lernfortschritt_nachvollziehbar",
    label: "Nachvollziehbarer Fortschritt",
    detail: "Jeder Score lässt sich auf konkrete Aufgaben zurückführen.",
  },
  transparente_bewertung: {
    kind: "transparente_bewertung",
    label: "Transparente Bewertung",
    detail: "Du siehst, warum etwas richtig oder falsch ist — nicht nur ob.",
  },
};

export function trustSignal(kind: TrustSignalKind): TrustSignal {
  return REGISTRY[kind];
}

export function trustSignals(kinds: readonly TrustSignalKind[]): TrustSignal[] {
  return kinds.map((k) => REGISTRY[k]);
}

/** Curated presets for common surfaces — keep contexts consistent. */
export const TRUST_PRESETS = {
  landing: ["rahmenplan_basiert", "pruefungsnah", "tutor_strict_rag", "keine_halluzination"],
  product: ["rahmenplan_basiert", "echte_pruefungslogik", "kompetenzbasiert", "transparente_bewertung"],
  tutor: ["tutor_strict_rag", "keine_halluzination", "explainable_ai", "kompetenzbasiert"],
  simulation: ["simulation_realistisch", "echte_pruefungslogik", "transparente_bewertung", "pruefungsnah"],
  oral: ["pruefungsnah", "explainable_ai", "transparente_bewertung", "kompetenzbasiert"],
} as const satisfies Record<string, readonly TrustSignalKind[]>;

export type TrustPresetKey = keyof typeof TRUST_PRESETS;
