/**
 * Funnel Events SSOT (Loop A — Quiz/Lead-Magnet)
 * --------------------------------------------------------------
 * Zentrale, typisierte Event-Konstanten für den Quiz-Funnel.
 * Niemals Strings im UI hardcoden — immer FUNNEL_EVENTS.* nutzen.
 *
 * Mapping zur DB-SSOT (`conversion_events.v2` event_type):
 *   LEAD_MAGNET_VIEW       -> 'lead_magnet_view'
 *   QUIZ_STARTED           -> 'quiz_start'
 *   QUIZ_COMPLETED         -> 'quiz_complete'
 *   LEAD_CAPTURE_SUBMITTED -> 'lead_capture'
 *   LERNPLAN_VIEWED        -> 'lernplan_view'
 *   BUNDLE_CTA_CLICKED     -> 'hero_cta_click' (intent='bundle')
 */
import type { FunnelEventType } from "./conversionTracking";
import { trackFunnel } from "./conversionTracking";

export const FUNNEL_EVENTS = {
  LEAD_MAGNET_VIEW: "lead_magnet_view",
  QUIZ_STARTED: "quiz_start",
  QUIZ_COMPLETED: "quiz_complete",
  LEAD_CAPTURE_SUBMITTED: "lead_capture",
  LERNPLAN_VIEWED: "lernplan_view",
  BUNDLE_CTA_CLICKED: "hero_cta_click",
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
 */
export function emitFunnelEvent(
  key: FunnelEventKey,
  payload: FunnelEventPayload = {}
): Promise<void> {
  const { curriculum_id, ...metadata } = payload;
  const intent = key === "BUNDLE_CTA_CLICKED" ? "bundle" : null;
  return trackFunnel(FUNNEL_EVENTS[key], {
    curriculum_id: curriculum_id ?? null,
    intent,
    metadata,
  });
}
