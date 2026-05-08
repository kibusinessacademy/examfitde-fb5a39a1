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
import { gtmEmitFunnel } from "@/lib/gtm";

export type FunnelEventType =
  | "hero_cta_click"
  | "pricing_view"
  | "checkout_start"
  | "checkout_complete"
  | "lead_magnet_download"
  | "quiz_complete"
  // ── Quiz/Lead-Magnet Funnel SSOT v2 (kanonisch) ──
  | "lead_magnet_view"
  | "quiz_started"
  | "quiz_completed"
  | "lead_capture_submitted"
  | "lernplan_viewed"
  | "bundle_cta_clicked"
  | "quiz_cta_clicked"
  // Legacy-Aliase (DB akzeptiert weiterhin, aber nicht mehr emittieren)
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
  | "add_to_cart"
  // ── Heatmap / CTA-Sichtbarkeit (Loop A Optimierung) ──
  | "heatmap_click"
  | "heatmap_scroll_depth"
  | "cta_visible"
  | "cta_clicked";

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
  /** SSOT: paketgebundene Events benötigen das. Strict events erzwingen es serverseitig. */
  package_id?: string | null;
  /** Persona-Kontext (azubi/betrieb/umschulung …) */
  persona?: string | null;
  /** Quelle (z.B. canonical SEO-Pfad) */
  source_page?: string | null;
}

const STRICT_EVENTS: ReadonlySet<FunnelEventType> = new Set([
  "quiz_started",
  "quiz_completed",
  "lead_capture_submitted",
  "checkout_complete",
]);

/**
 * Fire a funnel event. Never throws.
 *
 * Strict events (quiz_started, quiz_completed, lead_capture_submitted,
 * checkout_complete) require package_id — server raises 22023 otherwise
 * (no silent drift).
 */
export async function trackFunnel(
  eventType: FunnelEventType,
  opts: TrackOptions = {}
): Promise<void> {
  try {
    const page_path =
      typeof window !== "undefined" ? window.location.pathname : null;

    if (STRICT_EVENTS.has(eventType) && !opts.package_id && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[trackFunnel] ${eventType} requires package_id — server will reject`);
    }

    await supabase.rpc("track_conversion_event_v2" as any, {
      p_event_type: eventType,
      p_metadata: (opts.metadata ?? {}) as any,
      p_anonymous_id: getAnonymousId(),
      p_session_id: getSessionId(),
      p_page_path: page_path,
      p_curriculum_id: opts.curriculum_id ?? null,
      p_intent: opts.intent ?? null,
      p_contact_id: opts.contact_id ?? null,
      p_package_id: opts.package_id ?? null,
      p_persona: opts.persona ?? null,
      p_source_page: opts.source_page ?? page_path,
    });
  } catch (err) {
    // Tracking must never break the app
    if (typeof console !== "undefined") {
      console.warn("[trackFunnel] swallowed error:", err);
    }
  }
}
