/**
 * Phase 6.3 — Adaptive Transfer Complexity
 *
 * Pures Derivations-Modul. Liefert eine empfohlene Transferkomplexität
 * für die nächste Aufgabe — basierend auf Belastbarkeit, Stabilität und
 * aktuellem Risikoprofil. "Schwerer" ist NIE das Ziel — sondern Diagnostik.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type BehavioralSignals,
  type RiskKey,
  type RiskState,
} from "./SystemConsciousness";

export type TransferLevel = "konkret" | "anwendung" | "transfer" | "mehrdeutig" | "konflikt";

export interface TransferComplexity {
  level: TransferLevel;
  /** 0..1 — relative Komplexität, dramaturgisch zu interpretieren. */
  weight: number;
  /** Was diese Komplexität diagnostisch sichtbar macht. */
  diagnoses: string;
  /** Kontextwechsel-Hinweis für UI ("Fall wechselt vom Betrieb in den Kundenkontakt"). */
  contextShift?: string;
  rationale: string;
}

const LEVELS: Record<TransferLevel, Omit<TransferComplexity, "weight" | "rationale" | "contextShift">> = {
  konkret:    { level: "konkret",    diagnoses: "Grundwissen unter normalen Bedingungen." },
  anwendung:  { level: "anwendung",  diagnoses: "Anwendung des Wissens in bekanntem Kontext." },
  transfer:   { level: "transfer",   diagnoses: "Übertragung auf veränderten Kontext." },
  mehrdeutig: { level: "mehrdeutig", diagnoses: "Reaktion auf strittige Bewertungsgrundlage." },
  konflikt:   { level: "konflikt",   diagnoses: "Argumentation gegen Widerspruch." },
};

function r(risks: Record<RiskKey, RiskState>, k: RiskKey): RiskState | undefined {
  return risks[k];
}

export function deriveTransferComplexity(
  risks: Record<RiskKey, RiskState>,
  signals: BehavioralSignals,
): TransferComplexity {
  const transfer = r(risks, "transfer_argumentation");
  const struktur = r(risks, "antwortstruktur");
  const praxis = r(risks, "praxisbezug");

  // Wenn Struktur bricht: NIEMALS komplexer werden — Diagnostik braucht erst Stabilisierung.
  if ((struktur?.tone === "critical") || signals.structureStability < 0.4) {
    return {
      ...LEVELS.anwendung,
      weight: 0.35,
      rationale: "Strukturbruch erkannt — Komplexität bewusst reduziert, um Stabilität sichtbar zu machen.",
    };
  }

  // Transfer-Kollaps unter Druck: gezielte Transferdiagnostik
  if (transfer?.tone === "critical" && signals.timePressure >= 0.55) {
    return {
      ...LEVELS.transfer,
      weight: 0.7,
      contextShift: "Fall wechselt von vertrautem Betrieb in fremdes Kundenszenario.",
      rationale: "Transfer kollabiert unter Druck — Diagnose erfordert echte Übertragungssituation.",
    };
  }

  // Confidence stabil + hohe Strukturstabilität: höchste Stufe als bewusste Belastungsprüfung
  if (signals.confidence >= 0.7 && signals.structureStability >= 0.65 && signals.timePressure < 0.6) {
    return {
      ...LEVELS.mehrdeutig,
      weight: 0.8,
      contextShift: "Bewertungsgrundlage wird strittig — keine eindeutige Musterlösung.",
      rationale: "Stabilität hoch genug für mehrdeutige Bewertung — Argumentationstiefe wird sichtbar.",
    };
  }

  // Praxis fragil: Praxisbezug-Diagnostik priorisieren
  if (praxis && praxis.tone !== "stable") {
    return {
      ...LEVELS.anwendung,
      weight: 0.5,
      contextShift: "Anwendung im konkreten Praxisfall.",
      rationale: "Praxisbezug stabilisiert sich langsamer — Anwendungssituation priorisiert.",
    };
  }

  // Standard: Transfer-Niveau ohne Eskalation
  return {
    ...LEVELS.transfer,
    weight: 0.55,
    rationale: "Transferniveau als Baseline — beobachtende Diagnostik.",
  };
}

export function useTransferComplexity(): TransferComplexity {
  const { risks, signals } = useSystemConsciousness();
  return useMemo(() => deriveTransferComplexity(risks, signals), [risks, signals]);
}
