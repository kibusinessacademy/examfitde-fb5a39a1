/**
 * W1 Cut 3 — Tutor Surface Intelligence (deterministic hints).
 *
 * The AI tutor must NOT feel like ChatGPT — it must feel like an exam
 * coach. This module turns deterministic learner signals into framing
 * hints that the tutor UI prepends (NOT the model prompt).
 *
 * Hard rules:
 *  - Pure function. No AI calls.
 *  - Never overrides Strict-RAG citations or examiner facts.
 *  - Every hint has a `reason` (explainable).
 */

import type { IntentSignals, ResolvedIntent } from "./types";

export const TUTOR_HINT_KINDS = [
  "confusion_pattern",
  "high_uncertainty",
  "simplify_first",
  "challenge_up",
  "exam_imminent",
  "repeat_failure",
  "encouragement",
  "neutral",
] as const;
export type TutorHintKind = (typeof TUTOR_HINT_KINDS)[number];

export interface TutorHint {
  kind: TutorHintKind;
  framing: string;
  reason: string;
}

interface TutorContext {
  /** Top confused pair (e.g. {a:"Deckungsbeitrag", b:"Gewinn"}). */
  confused_pair?: { a: string; b: string };
  /** Number of repeated failures on the current topic. */
  repeat_failures?: number;
  /** Weak competency name in current scope. */
  weakest_competency?: string;
}

export function tutorHint(
  intent: ResolvedIntent,
  signals: IntentSignals = {},
  ctx: TutorContext = {},
): TutorHint {
  const r = signals.readiness;
  const days = signals.behaviour?.days_to_exam;

  if (ctx.confused_pair) {
    const { a, b } = ctx.confused_pair;
    return {
      kind: "confusion_pattern",
      framing: `Du verwechselst aktuell ${a} und ${b} — das passiert in Prüfungen sehr häufig.`,
      reason: "confusion_pattern",
    };
  }

  if ((ctx.repeat_failures ?? 0) >= 3) {
    return {
      kind: "repeat_failure",
      framing: ctx.weakest_competency
        ? `Bei ${ctx.weakest_competency} gibt es ein wiederkehrendes Muster — lass uns das zuerst lösen.`
        : "Ich sehe ein wiederkehrendes Fehlermuster — lass uns das zuerst lösen.",
      reason: "repeat_failures",
    };
  }

  if (days != null && days <= 14) {
    return {
      kind: "exam_imminent",
      framing: `Noch ${days} Tage bis zur Prüfung — wir konzentrieren uns auf prüfungsnahe Fälle.`,
      reason: "exam_imminent",
    };
  }

  if (intent.emotional_state === "panisch" || intent.emotional_state === "ueberfordert") {
    return {
      kind: "simplify_first",
      framing: "Lass uns das zuerst vereinfachen, bevor wir tiefer gehen.",
      reason: "high_emotional_load",
    };
  }

  if (r && r.risk_level === "low" && r.readiness_score >= 80) {
    return {
      kind: "challenge_up",
      framing: "Du bist solide — lass uns jetzt schwierigere Prüfungsfälle angehen.",
      reason: "high_mastery",
    };
  }

  if (r?.risk_level === "high" || intent.emotional_state === "unsicher") {
    return {
      kind: "high_uncertainty",
      framing: "Ich gehe Schritt für Schritt mit dir durch — ohne Sprünge.",
      reason: "high_uncertainty",
    };
  }

  if (intent.emotional_state === "motiviert" || intent.emotional_state === "selbstbewusst") {
    return {
      kind: "encouragement",
      framing: "Guter Lauf — wir bleiben dran und ziehen das Niveau leicht an.",
      reason: "positive_streak",
    };
  }

  return {
    kind: "neutral",
    framing: "Sag mir, woran du gerade arbeitest — ich richte mich danach.",
    reason: "default",
  };
}
