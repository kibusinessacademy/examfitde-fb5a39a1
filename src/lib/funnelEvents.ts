/**
 * Funnel Events SSOT v2 (Loop A — Quiz/Lead-Magnet)
 * --------------------------------------------------------------
 * Zentrale, typisierte Event-Konstanten. Niemals Strings im UI hardcoden.
 *
 * Kanonische Namen (1:1, kein Mapping/Übersetzung):
 *   LEAD_MAGNET_VIEW       -> 'lead_magnet_view'
 *   QUIZ_STARTED           -> 'quiz_started'
 *   QUIZ_COMPLETED         -> 'quiz_completed'
 *   LEAD_CAPTURE_SUBMITTED -> 'lead_capture_submitted'
 *   LERNPLAN_VIEWED        -> 'lernplan_viewed'
 *   BUNDLE_CTA_CLICKED     -> 'bundle_cta_clicked'
 */
import type { FunnelEventType } from "./conversionTracking";
import { trackFunnel } from "./conversionTracking";

export const FUNNEL_EVENTS = {
  LEAD_MAGNET_VIEW: "lead_magnet_view",
  QUIZ_CTA_CLICKED: "quiz_cta_clicked",
  QUIZ_STARTED: "quiz_started",
  QUIZ_COMPLETED: "quiz_completed",
  LEAD_CAPTURE_SUBMITTED: "lead_capture_submitted",
  LERNPLAN_VIEWED: "lernplan_viewed",
  BUNDLE_CTA_CLICKED: "bundle_cta_clicked",
} as const satisfies Record<string, FunnelEventType>;

export type FunnelEventKey = keyof typeof FUNNEL_EVENTS;

export interface FunnelEventPayload {
  curriculum_id?: string | null;
  quiz_slug?: string;
  lernplan_slug?: string;
  bundle_slug?: string;
  attempt_id?: string | null;
  score?: number | null;
  passed?: boolean | null;
  source?: string;
  cta_location?: string;
  marketing_consent?: boolean;
  [key: string]: unknown;
}

/**
 * Typed funnel-event emitter. Use this everywhere instead of trackFunnel directly.
 * BUNDLE_CTA_CLICKED wird als eigenständiges Event geschrieben — NICHT auf
 * hero_cta_click gemappt (Auswertung sonst verwässert).
 */
export function emitFunnelEvent(
  key: FunnelEventKey,
  payload: FunnelEventPayload = {}
): Promise<void> {
  const { curriculum_id, ...metadata } = payload;
  return trackFunnel(FUNNEL_EVENTS[key], {
    curriculum_id: curriculum_id ?? null,
    intent: key === "BUNDLE_CTA_CLICKED" ? "bundle" : null,
    metadata,
  });
}
