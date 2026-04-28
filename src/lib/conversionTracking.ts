/**
 * Conversion Tracking SSOT (Loop A)
 * --------------------------------------------------------------
 * Single, project-wide entry point for the 6 mandatory funnel events:
 *   - hero_cta_click
 *   - pricing_view
 *   - checkout_start
 *   - checkout_complete
 *   - lead_magnet_download
 *   - quiz_complete
 *
 * Works for anonymous AND authenticated visitors via the
 * `track_conversion_event_v2` RPC (SECURITY DEFINER).
 *
 * - Anonymous ID is persisted in localStorage (`ef_anon_id`)
 * - Session ID is per tab (sessionStorage `ef_session_id`)
 * - All calls are fire-and-forget; failures must NEVER block UI.
 */
import { supabase } from "@/integrations/supabase/client";

export type FunnelEventType =
  | "hero_cta_click"
  | "pricing_view"
  | "checkout_start"
  | "checkout_complete"
  | "lead_magnet_download"
  | "quiz_complete"
  // ── Quiz/Lead-Magnet Funnel ──
  | "lead_magnet_view"
  | "quiz_start"
  | "lead_capture"
  | "lernplan_view"
  | "optin_submit"
  | "doi_confirmed"
  | "b2b_form_submit"
  | "course_open"
  | "exam_attempt"
  // ── Funnel-Tiefen-Events ──
  | "page_view"
  | "add_to_cart";

const ANON_KEY = "ef_anon_id";
const SESSION_KEY = "ef_session_id";

function getOrCreate(storage: Storage, key: string): string {
  try {
    let v = storage.getItem(key);
    if (!v) {
      v =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      storage.setItem(key, v);
    }
    return v;
  } catch {
    return `ephemeral-${Date.now()}`;
  }
}

export function getAnonymousId(): string {
  if (typeof window === "undefined") return "ssr";
  return getOrCreate(window.localStorage, ANON_KEY);
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  return getOrCreate(window.sessionStorage, SESSION_KEY);
}

export interface TrackOptions {
  metadata?: Record<string, unknown>;
  curriculum_id?: string | null;
  intent?: string | null;
  contact_id?: string | null;
}

/**
 * Fire a funnel event. Never throws.
 */
export async function trackFunnel(
  eventType: FunnelEventType,
  opts: TrackOptions = {}
): Promise<void> {
  try {
    const page_path =
      typeof window !== "undefined" ? window.location.pathname : null;

    await supabase.rpc("track_conversion_event_v2" as any, {
      p_event_type: eventType,
      p_metadata: (opts.metadata ?? {}) as any,
      p_anonymous_id: getAnonymousId(),
      p_session_id: getSessionId(),
      p_page_path: page_path,
      p_curriculum_id: opts.curriculum_id ?? null,
      p_intent: opts.intent ?? null,
      p_contact_id: opts.contact_id ?? null,
    });
  } catch (err) {
    // Tracking must never break the app
    if (typeof console !== "undefined") {
      console.warn("[trackFunnel] swallowed error:", err);
    }
  }
}
