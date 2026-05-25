/**
 * W1 Cut 3b — Adaptive Decision Telemetry (SSOT, explainable, governed).
 *
 * Emits exactly 3 event_types via the existing `track-funnel-event` edge
 * function (anon + auth safe). NEVER carries free text, raw chat, personal
 * diagnoses — only structured intent/learning signals.
 *
 *   - adaptive_cta_decision   (every time a smart CTA renders or is clicked)
 *   - recommendation_view     (when a semantic recommendation surfaces)
 *   - recommendation_click    (when the user follows a recommendation)
 *
 * Pflichtfelder (Cut 3b SSOT):
 *   entity_kind · entity_slug · persona · intent_kind · readiness_bucket
 *   · emotional_state · cta_variant · tone · explainable_cta_reason
 *   · recommended_action · confidence_bucket · exam_phase · session_depth_bucket
 *
 * Hard rules:
 *   - Fire-and-forget. Never blocks UI.
 *   - Pure structured fields — no free text, no PII.
 *   - Deterministic bucketing — same inputs ⇒ same bucket.
 */

import { supabase } from "@/integrations/supabase/client";
import type { AdaptiveCtaDecision } from "./adaptive-cta";
import type { IntentSignals, ResolvedIntent } from "./types";

export type ReadinessBucket =
  | "unknown"
  | "0_20"
  | "20_40"
  | "40_60"
  | "60_75"
  | "75_90"
  | "90_100";

export type ConfidenceBucket = "unknown" | "low" | "medium" | "high";
export type ExamPhase =
  | "unknown"
  | "early"        // > 90 days
  | "mid"          // 43–90
  | "endspurt"     // 15–42
  | "imminent"     // 1–14
  | "post"         // past exam (negative days)
  ;
export type SessionDepthBucket = "cold" | "light" | "active" | "deep";

export function readinessBucket(score?: number | null): ReadinessBucket {
  if (score == null || !Number.isFinite(score)) return "unknown";
  if (score < 20) return "0_20";
  if (score < 40) return "20_40";
  if (score < 60) return "40_60";
  if (score < 75) return "60_75";
  if (score < 90) return "75_90";
  return "90_100";
}

export function confidenceBucket(conf?: number | null): ConfidenceBucket {
  if (conf == null || !Number.isFinite(conf)) return "unknown";
  if (conf < 0.34) return "low";
  if (conf < 0.67) return "medium";
  return "high";
}

export function examPhase(daysToExam?: number | null): ExamPhase {
  if (daysToExam == null || !Number.isFinite(daysToExam)) return "unknown";
  if (daysToExam < 0) return "post";
  if (daysToExam <= 14) return "imminent";
  if (daysToExam <= 42) return "endspurt";
  if (daysToExam <= 90) return "mid";
  return "early";
}

export function sessionDepthBucket(sessionsLast7d?: number | null): SessionDepthBucket {
  const s = sessionsLast7d ?? 0;
  if (s === 0) return "cold";
  if (s <= 2) return "light";
  if (s <= 5) return "active";
  return "deep";
}

export interface AdaptiveCtaDecisionEventInput {
  decision: AdaptiveCtaDecision;
  intent: ResolvedIntent;
  signals?: IntentSignals;
  entity_kind?: string;
  entity_slug?: string;
  persona?: string | null;
  package_id?: string | null;
  /** "rendered" vs "clicked" — both flow into the same event_type for SSOT. */
  phase: "rendered" | "clicked";
  /** Examiner confidence 0..1 (read-only mirror). */
  confidence?: number | null;
}

const ANON_KEY = "ef_anon_id";
const SESSION_KEY = "ef_session_id";

function anonId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let v = window.localStorage.getItem(ANON_KEY);
    if (!v) {
      v = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `a_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(ANON_KEY, v);
    }
    return v;
  } catch { return `ephemeral-${Date.now()}`; }
}

function sessId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let v = window.sessionStorage.getItem(SESSION_KEY);
    if (!v) {
      v = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      window.sessionStorage.setItem(SESSION_KEY, v);
    }
    return v;
  } catch { return `ephemeral-${Date.now()}`; }
}

/** Pure builder — used by both the emitter and tests. */
export function buildAdaptiveCtaDecisionPayload(input: AdaptiveCtaDecisionEventInput) {
  const { decision, intent, signals, confidence } = input;
  return {
    // Top-level routing fields the edge function recognises.
    event_type: "adaptive_cta_decision",
    package_id: input.package_id ?? null,
    persona: input.persona ?? null,
    page_path: typeof window !== "undefined" ? window.location.pathname : null,
    metadata: {
      // SSOT Pflichtfelder
      entity_kind: input.entity_kind ?? "unknown",
      entity_slug: input.entity_slug ?? "unknown",
      intent_kind: intent.primary,
      readiness_bucket: readinessBucket(signals?.readiness?.readiness_score),
      emotional_state: intent.emotional_state,
      cta_variant: decision.variant,
      tone: decision.tone,
      explainable_cta_reason: decision.reason,
      recommended_action: decision.action_type,
      confidence_bucket: confidenceBucket(confidence ?? intent.confidence),
      exam_phase: examPhase(signals?.behaviour?.days_to_exam),
      session_depth_bucket: sessionDepthBucket(signals?.behaviour?.sessions_last_7d),
      // sub-phase (render/click) — analytics dedup
      phase: input.phase,
      urgency_level: decision.urgency_level,
    },
  } as const;
}

export function recordAdaptiveCtaDecision(input: AdaptiveCtaDecisionEventInput): void {
  const payload = buildAdaptiveCtaDecisionPayload(input);
  void supabase.functions
    .invoke("track-funnel-event", {
      body: { ...payload, anonymous_id: anonId(), session_id: sessId() },
    })
    .catch(() => { /* fire-and-forget */ });
}

/* ------------------------------------------------------------------ */
/* Recommendation telemetry                                            */
/* ------------------------------------------------------------------ */

export interface RecommendationEventInput {
  recommendation_id: string;
  source_entity_kind: string;
  source_entity_slug: string;
  recommendation_reason: string;
  semantic_similarity_score: number; // 0..1
  competency_overlap: number;        // count
  exam_relevance: "low" | "medium" | "high";
  weakness_relation: "direct" | "adjacent" | "preventive";
  persona?: string | null;
  package_id?: string | null;
}

function buildRecPayload(eventType: "recommendation_view" | "recommendation_click", input: RecommendationEventInput) {
  return {
    event_type: eventType,
    package_id: input.package_id ?? null,
    persona: input.persona ?? null,
    page_path: typeof window !== "undefined" ? window.location.pathname : null,
    metadata: {
      recommendation_id: input.recommendation_id,
      source_entity_kind: input.source_entity_kind,
      source_entity_slug: input.source_entity_slug,
      recommendation_reason: input.recommendation_reason,
      semantic_similarity_score: Math.max(0, Math.min(1, input.semantic_similarity_score)),
      competency_overlap: Math.max(0, Math.floor(input.competency_overlap)),
      exam_relevance: input.exam_relevance,
      weakness_relation: input.weakness_relation,
    },
  } as const;
}

export function recordRecommendationView(input: RecommendationEventInput): void {
  const payload = buildRecPayload("recommendation_view", input);
  void supabase.functions
    .invoke("track-funnel-event", { body: { ...payload, anonymous_id: anonId(), session_id: sessId() } })
    .catch(() => {});
}

export function recordRecommendationClick(input: RecommendationEventInput): void {
  const payload = buildRecPayload("recommendation_click", input);
  void supabase.functions
    .invoke("track-funnel-event", { body: { ...payload, anonymous_id: anonId(), session_id: sessId() } })
    .catch(() => {});
}

export const __testing = { buildRecPayload };
