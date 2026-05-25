/**
 * W1 Cut 2 — Intent Routing SSOT.
 *
 * Closed taxonomy of user intents. NEVER widen without a memory update
 * and golden-test extension. Intent layer is deterministic — no AI, no
 * readiness/confidence/verdict recomputation (examiner facts stay in
 * @/lib/examiner).
 */

export const INTENT_KINDS = [
  "bestehen",
  "pruefung_angst",
  "letzte_wochen",
  "muendliche_pruefung",
  "unsicherheit",
  "lernplan",
  "simulation",
  "ihk_fragen",
  "durchgefallen",
  "wiederholung",
  "karriere",
  "gehalt",
  "kompetenzproblem",
  "zeitmangel",
  "motivation",
  "unknown",
] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

export const URGENCY_LEVELS = ["low", "medium", "high", "critical"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const EMOTIONAL_STATES = [
  "neutral",
  "ueberfordert",
  "unsicher",
  "motiviert",
  "panisch",
  "selbstbewusst",
  "frustriert",
  "vermeidend",
] as const;
export type EmotionalState = (typeof EMOTIONAL_STATES)[number];

export const RECOMMENDED_SURFACES = [
  "diagnose_quiz",
  "exam_simulation",
  "oral_simulation",
  "weakness_training",
  "study_plan",
  "tutor",
  "product_landing",
  "readiness_check",
] as const;
export type RecommendedSurface = (typeof RECOMMENDED_SURFACES)[number];

export interface IntentSignals {
  /** Pathname (no host, no query) — e.g. "/wissen/beruf/industriekaufmann". */
  path?: string;
  /** Raw query string (incl. or excl. leading "?"). */
  query?: string;
  /** UTM source/medium/campaign already extracted, optional. */
  utm?: { source?: string; medium?: string; campaign?: string };
  /** Latest readiness snapshot from examiner (read-only). */
  readiness?: {
    readiness_score: number;
    risk_level: "low" | "medium" | "high";
    weak_count?: number;
  } | null;
  /** Optional behaviour signals (deterministic flags). */
  behaviour?: {
    sessions_last_7d?: number;
    avg_session_min?: number;
    error_rate_30d?: number;
    days_to_exam?: number;
  };
}

export interface ResolvedIntent {
  primary: IntentKind;
  confidence: number; // 0..1, deterministic
  urgency: Urgency;
  emotional_state: EmotionalState;
  recommended_surface: RecommendedSurface;
  /** Audit trail of which rule matched (for tests + analytics). */
  reason: string;
}
