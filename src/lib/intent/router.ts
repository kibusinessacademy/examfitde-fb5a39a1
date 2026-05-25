/**
 * W1 Cut 2 — Intent Router (deterministic, regex-first).
 *
 * Pure function. No network, no AI fallback. Same input ⇒ same output.
 * If no rule matches confidently, returns `unknown` with a safe default
 * surface (diagnose_quiz). The optional Lovable-AI fallback is reserved
 * for a later cut and MUST not be wired here.
 */

import type {
  EmotionalState,
  IntentKind,
  IntentSignals,
  RecommendedSurface,
  ResolvedIntent,
  Urgency,
} from "./types";

interface Rule {
  intent: IntentKind;
  pattern: RegExp;
  confidence: number;
  urgency: Urgency;
  surface: RecommendedSurface;
}

/**
 * Order matters — first match wins. Patterns are matched against the
 * normalised string `path + " " + query` (lowercased).
 */
const RULES: ReadonlyArray<Rule> = [
  { intent: "durchgefallen",       pattern: /durchgefallen|nicht\s*bestanden|wiederholungspruefung/, confidence: 0.95, urgency: "critical", surface: "weakness_training" },
  { intent: "pruefung_angst",      pattern: /pruefungs?angst|angst|panik|nervoes/,                  confidence: 0.9,  urgency: "high",     surface: "readiness_check" },
  { intent: "letzte_wochen",       pattern: /letzte[-_\s]*wochen|4[-_\s]*wochen|endspurt|crash/,    confidence: 0.9,  urgency: "high",     surface: "study_plan" },
  { intent: "muendliche_pruefung", pattern: /muendlich|fachgespraech|oral/,                         confidence: 0.92, urgency: "medium",   surface: "oral_simulation" },
  { intent: "ihk_fragen",          pattern: /ihk[-_\s]*fragen|typische[-_\s]*fragen|altklausur/,    confidence: 0.88, urgency: "medium",   surface: "exam_simulation" },
  { intent: "simulation",          pattern: /simulation|pruefungssimul|probepruefung/,              confidence: 0.85, urgency: "medium",   surface: "exam_simulation" },
  { intent: "lernplan",            pattern: /lernplan|study[-_\s]*plan|wochenplan/,                 confidence: 0.85, urgency: "medium",   surface: "study_plan" },
  { intent: "wiederholung",        pattern: /wiederholung|repetition|nochmal/,                      confidence: 0.7,  urgency: "low",      surface: "weakness_training" },
  { intent: "kompetenzproblem",    pattern: /schwaeche|lernfeld|kompetenz|verstehe[-_\s]*nicht/,    confidence: 0.75, urgency: "medium",   surface: "weakness_training" },
  { intent: "karriere",            pattern: /karriere|weiterbildung|aufstieg/,                      confidence: 0.7,  urgency: "low",      surface: "product_landing" },
  { intent: "gehalt",              pattern: /gehalt|verdienst|einkommen/,                           confidence: 0.7,  urgency: "low",      surface: "product_landing" },
  { intent: "zeitmangel",          pattern: /keine[-_\s]*zeit|zeitmangel|schnell|express/,          confidence: 0.7,  urgency: "high",     surface: "study_plan" },
  { intent: "motivation",          pattern: /motivation|aufgeben|durchhalten/,                      confidence: 0.65, urgency: "low",      surface: "tutor" },
  { intent: "unsicherheit",        pattern: /unsicher|zweifel|reicht[-_\s]*das/,                    confidence: 0.7,  urgency: "medium",   surface: "readiness_check" },
  { intent: "bestehen",            pattern: /bestehen|pass|schaffen/,                               confidence: 0.6,  urgency: "medium",   surface: "diagnose_quiz" },
];

const URGENCY_RANK: Record<Urgency, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function normalise(s: string | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/^\?/, "");
}

function pickEmotionalState(
  intent: IntentKind,
  signals: IntentSignals,
): EmotionalState {
  const b = signals.behaviour;
  const r = signals.readiness;

  if (intent === "pruefung_angst" || intent === "durchgefallen") return "panisch";
  if (intent === "letzte_wochen" || intent === "zeitmangel") return "ueberfordert";
  if (intent === "motivation") return "vermeidend";

  if (r?.risk_level === "high") return "unsicher";
  if (r?.risk_level === "low" && (r.readiness_score ?? 0) >= 80) return "selbstbewusst";

  if (b?.error_rate_30d != null && b.error_rate_30d > 0.5) return "frustriert";
  if (b?.sessions_last_7d != null && b.sessions_last_7d >= 5) return "motiviert";

  return "neutral";
}

function escalateUrgency(base: Urgency, signals: IntentSignals): Urgency {
  const b = signals.behaviour;
  let level = URGENCY_RANK[base];
  if (b?.days_to_exam != null) {
    if (b.days_to_exam <= 14) level = Math.max(level, URGENCY_RANK.critical);
    else if (b.days_to_exam <= 42) level = Math.max(level, URGENCY_RANK.high);
  }
  if (signals.readiness?.risk_level === "high") {
    level = Math.max(level, URGENCY_RANK.high);
  }
  const entries = Object.entries(URGENCY_RANK) as Array<[Urgency, number]>;
  return entries.find(([, v]) => v === level)?.[0] ?? base;
}

export function resolveIntent(signals: IntentSignals): ResolvedIntent {
  const haystack = `${normalise(signals.path)} ${normalise(signals.query)}`.trim();

  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) {
      const urgency = escalateUrgency(rule.urgency, signals);
      return {
        primary: rule.intent,
        confidence: rule.confidence,
        urgency,
        emotional_state: pickEmotionalState(rule.intent, signals),
        recommended_surface: rule.surface,
        reason: `rule:${rule.intent}`,
      };
    }
  }

  // Fallback — readiness-derived best guess (no recomputation, just routing).
  const r = signals.readiness;
  if (r?.risk_level === "high") {
    return {
      primary: "kompetenzproblem",
      confidence: 0.5,
      urgency: escalateUrgency("high", signals),
      emotional_state: pickEmotionalState("kompetenzproblem", signals),
      recommended_surface: "weakness_training",
      reason: "fallback:readiness_high",
    };
  }
  if (r?.risk_level === "medium") {
    return {
      primary: "simulation",
      confidence: 0.45,
      urgency: escalateUrgency("medium", signals),
      emotional_state: pickEmotionalState("simulation", signals),
      recommended_surface: "exam_simulation",
      reason: "fallback:readiness_medium",
    };
  }

  return {
    primary: "unknown",
    confidence: 0.2,
    urgency: escalateUrgency("low", signals),
    emotional_state: pickEmotionalState("bestehen", signals),
    recommended_surface: "diagnose_quiz",
    reason: "fallback:default",
  };
}
