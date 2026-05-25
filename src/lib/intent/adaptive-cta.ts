/**
 * W1 Cut 3 — Adaptive CTA Engine (deterministic, explainable).
 *
 * Maps a {ResolvedIntent} + light context signals to:
 *   - variant      : motivational | urgency | risk | confidence
 *                    | simulation | oral | recovery | diagnostic
 *   - tone         : calm | direct | empathic | sharp
 *   - urgency_level: low | medium | high | critical (mirrors router)
 *   - action_type  : matches RecommendedSurface from router
 *   - message      : final CTA copy (uses ctaFor() label as fallback)
 *   - reason       : machine-readable explainable_cta_reason
 *                    (e.g. "exam_near", "low_mastery", "oral_focus")
 *
 * Hard rules
 * ----------
 *  - Pure function. No AI, no network, no random.
 *  - Never recomputes readiness / mastery / verdict — examiner-isolated.
 *  - Every output carries a `reason` (audit + analytics).
 *  - Adds zero new IntentKinds — extends Cut 2 SSOT only.
 */

import { ctaFor } from "./cta-map";
import type {
  IntentSignals,
  RecommendedSurface,
  ResolvedIntent,
  Urgency,
} from "./types";

export const CTA_VARIANTS = [
  "motivational",
  "urgency",
  "risk",
  "confidence",
  "simulation",
  "oral",
  "recovery",
  "diagnostic",
] as const;
export type CtaVariant = (typeof CTA_VARIANTS)[number];

export const CTA_TONES = ["calm", "direct", "empathic", "sharp"] as const;
export type CtaTone = (typeof CTA_TONES)[number];

export interface AdaptiveCtaDecision {
  variant: CtaVariant;
  tone: CtaTone;
  urgency_level: Urgency;
  action_type: RecommendedSurface;
  message: string;
  /** Explainable, machine-readable reason — for audit + analytics. */
  reason: string;
}

interface ExtraContext {
  /** Optional: known top-1 weak competency label. */
  weakest_competency?: string;
  /** Optional: number of repeated failures on similar items. */
  repeat_failures?: number;
  /** Optional: count of completed simulations. */
  simulation_history?: number;
}

function pickTone(intent: ResolvedIntent): CtaTone {
  switch (intent.emotional_state) {
    case "panisch":
    case "ueberfordert":
      return "empathic";
    case "frustriert":
    case "vermeidend":
      return "empathic";
    case "selbstbewusst":
    case "motiviert":
      return "direct";
    case "unsicher":
      return "calm";
    default:
      return intent.urgency === "critical" ? "sharp" : "calm";
  }
}

export function chooseAdaptiveCta(
  intent: ResolvedIntent,
  signals: IntentSignals = {},
  extra: ExtraContext = {},
): AdaptiveCtaDecision {
  const tone = pickTone(intent);
  const fallbackMessage = ctaFor(intent).primary.label;
  const days = signals.behaviour?.days_to_exam;
  const r = signals.readiness;

  // 1) Failure recovery dominates everything (psychology of "durchgefallen").
  if (intent.primary === "durchgefallen") {
    return {
      variant: "recovery",
      tone: "empathic",
      urgency_level: "critical",
      action_type: "weakness_training",
      message: extra.weakest_competency
        ? `Konzentriere dich zuerst auf ${extra.weakest_competency}.`
        : "Konzentriere dich zuerst auf deine echten Schwachstellen.",
      reason: "failure_recovery",
    };
  }

  // 2) Oral exam focus.
  if (intent.primary === "muendliche_pruefung") {
    return {
      variant: "oral",
      tone,
      urgency_level: intent.urgency,
      action_type: "oral_simulation",
      message: "Trainiere typische Fachgesprächsfragen.",
      reason: "oral_exam_focus",
    };
  }

  // 3) Imminent exam → urgency framing.
  if (days != null && days <= 14) {
    return {
      variant: "urgency",
      tone: "sharp",
      urgency_level: "critical",
      action_type: "study_plan",
      message: `Noch ${days} Tage bis zur Prüfung — nutze sie fokussiert.`,
      reason: "exam_imminent",
    };
  }
  if (days != null && days <= 42) {
    return {
      variant: "urgency",
      tone: "direct",
      urgency_level: "high",
      action_type: "study_plan",
      message: `Noch ${days} Tage bis zur Prüfung — starte deinen Endspurt-Plan.`,
      reason: "exam_near",
    };
  }

  // 4) High risk → risk framing (no scaremongering).
  if (r?.risk_level === "high") {
    const weak = r.weak_count;
    return {
      variant: "risk",
      tone: "empathic",
      urgency_level: "high",
      action_type: "readiness_check",
      message:
        weak != null && weak > 0
          ? `${weak} Kompetenzbereich${weak === 1 ? "" : "e"} gefährde${weak === 1 ? "t" : "n"} aktuell dein Bestehen.`
          : "Aktuell ist deine Prüfungsreife gefährdet — lass uns sie schärfen.",
      reason: "high_risk",
    };
  }

  // 5) Confident learner → push to simulation.
  if (r && r.readiness_score >= 75 && r.risk_level === "low") {
    return {
      variant: "confidence",
      tone: "direct",
      urgency_level: intent.urgency,
      action_type: "exam_simulation",
      message: `Du bist in ${Math.round(r.readiness_score)} % der prüfungsrelevanten Themen sicher.`,
      reason: "high_mastery",
    };
  }

  // 6) Simulation-ready (medium risk + some sessions).
  if (
    r?.risk_level === "medium" &&
    (signals.behaviour?.sessions_last_7d ?? 0) >= 3
  ) {
    return {
      variant: "simulation",
      tone: "direct",
      urgency_level: intent.urgency,
      action_type: "exam_simulation",
      message: "Starte jetzt eine realistische Prüfungssimulation.",
      reason: "simulation_ready",
    };
  }

  // 7) Repeated failures → recovery (even without explicit intent).
  if ((extra.repeat_failures ?? 0) >= 3) {
    return {
      variant: "recovery",
      tone: "empathic",
      urgency_level: "medium",
      action_type: "weakness_training",
      message: extra.weakest_competency
        ? `Lass uns ${extra.weakest_competency} gezielt aufarbeiten.`
        : "Lass uns deine wiederkehrenden Fehlerquellen aufarbeiten.",
      reason: "repeat_failures",
    };
  }

  // 8) Unknown / first-time → diagnostic.
  if (intent.primary === "unknown" || !r) {
    return {
      variant: "diagnostic",
      tone,
      urgency_level: intent.urgency,
      action_type: "diagnose_quiz",
      message: "Prüfungsreife in 4 Minuten prüfen — kostenlos, ohne Anmeldung.",
      reason: "no_baseline",
    };
  }

  // 9) Default — motivational framing using router surface.
  return {
    variant: "motivational",
    tone,
    urgency_level: intent.urgency,
    action_type: intent.recommended_surface,
    message: `Du bist näher an der Prüfung als du denkst. ${fallbackMessage}`,
    reason: "default_motivational",
  };
}
