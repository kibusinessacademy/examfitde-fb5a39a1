/**
 * Phase 6.9 — Predictive Readiness Intelligence
 *
 * Pures Derivations-Modul. Prognose der Prüfungsstabilität auf Basis
 * aktueller Signals + Risk-Trends + Recovery-Index. KEINE Wahrsagerei —
 * nur prüferisch plausible Zukunftsbewertung mit Confidence-Band.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type BehavioralSignals,
  type RiskKey,
  type RiskState,
} from "./SystemConsciousness";
import { deriveRecovery } from "./RecoveryLogic";

export interface ReadinessProjection {
  horizonDays: number;
  /** 0..100 — projizierte Prüfungsreife. */
  projected: number;
  /** Konfidenzband (0..100). */
  low: number;
  high: number;
  /** Warum dieses Szenario plausibel ist. */
  drivers: string[];
}

export interface PredictiveReadinessView {
  current: number;
  /** Trend pro Tag in Punkten (bounded -3..+3). */
  dailyDelta: number;
  /** 0..1 — wahrscheinliche Bestehensreife in 14 Tagen. */
  probabilityReady: number;
  /** Konfidenz des Modells 0..1 — sinkt bei volatilem Signal. */
  confidence: number;
  projections: ReadinessProjection[];
  /** Eine strategische Empfehlung — kein Menü. */
  strategicSuggestion: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function derivePredictiveReadiness(
  risks: Record<RiskKey, RiskState>,
  signals: BehavioralSignals,
  readiness: number,
  recoveryIndex: number,
): PredictiveReadinessView {
  const all = Object.values(risks);
  const critical = all.filter((r) => r.tone === "critical").length;
  const stable = all.filter((r) => r.tone === "stable").length;

  // Trend: Recovery zieht hoch, kritische Risiken ziehen runter
  const dailyDelta = clamp(
    (recoveryIndex / 100) * 1.2 - critical * 0.4 + (stable / Math.max(1, all.length)) * 0.8 - 0.3,
    -3,
    3,
  );

  // Volatilität: Differenz Pressure↔Stability
  const volatility = Math.abs(signals.timePressure - signals.structureStability);
  const confidence = clamp(1 - volatility * 0.8 - critical * 0.05, 0.3, 0.95);

  const horizons = [3, 7, 14, 30];
  const projections: ReadinessProjection[] = horizons.map((h) => {
    const projected = clamp(readiness + dailyDelta * h, 0, 100);
    const band = (1 - confidence) * 20 + (h / 30) * 8;
    return {
      horizonDays: h,
      projected: Math.round(projected),
      low: Math.round(clamp(projected - band, 0, 100)),
      high: Math.round(clamp(projected + band, 0, 100)),
      drivers: [
        critical > 0 ? `${critical} kritische Risiken bremsen Trend` : "keine kritischen Bremsfaktoren",
        recoveryIndex >= 45 ? "Recovery-Muster konsistent" : "Recovery-Muster noch fragil",
        signals.timePressure >= 0.6 ? "Belastung erhöht — Trend dämpft" : "Belastung im Rahmen",
      ],
    };
  });

  const projected14 = projections[2].projected;
  const probabilityReady = clamp((projected14 - 55) / 30, 0, 1);

  let strategicSuggestion = "Aktuelle Sequenz beibehalten — Stabilisierung läuft.";
  if (critical >= 2) {
    strategicSuggestion = "Dramaturgie auf kritische Muster fokussieren, Belastungsspitzen reduzieren.";
  } else if (dailyDelta < 0) {
    strategicSuggestion = "Recovery-Phase einbauen, neue Belastungsspitzen aussetzen.";
  } else if (projected14 >= 80 && confidence >= 0.7) {
    strategicSuggestion = "Belastungsdiagnostik intensivieren — Stabilität erlaubt schärfere Probes.";
  }

  return {
    current: Math.round(readiness),
    dailyDelta: Number(dailyDelta.toFixed(2)),
    probabilityReady: Number(probabilityReady.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    projections,
    strategicSuggestion,
  };
}

export function usePredictiveReadiness(): PredictiveReadinessView {
  const { risks, signals, memory, readiness } = useSystemConsciousness();
  return useMemo(() => {
    const recovery = deriveRecovery(signals, memory);
    return derivePredictiveReadiness(risks, signals, readiness, recovery.index);
  }, [risks, signals, memory, readiness]);
}
