/**
 * Partner Attribution Client
 * 
 * Handles:
 * 1. Detecting partner referral params (?ref=CODE or ?slug=SLUG) on landing
 * 2. Generating a persistent visitor_id
 * 3. Firing track-partner-click edge function
 * 4. Storing attribution cookie (partner_id + visitor_id) for checkout linking
 * 5. Linking visitor_id to user_id after auth (via partner_attributions update)
 */

import { supabase } from "@/integrations/supabase/client";

const VISITOR_ID_KEY = "ef_visitor_id";
const PARTNER_ATTR_KEY = "ef_partner_attr";
const TRACKED_KEY = "ef_partner_tracked";

interface PartnerAttrData {
  partner_id: string;
  ref_code: string;
  tracking_link_id?: string;
  attribution_window_days: number;
  tracked_at: string;
}

/** Generate or retrieve persistent visitor ID */
function getVisitorId(): string {
  let vid = localStorage.getItem(VISITOR_ID_KEY);
  if (!vid) {
    vid = crypto.randomUUID();
    localStorage.setItem(VISITOR_ID_KEY, vid);
  }
  return vid;
}

/** Get stored attribution data */
export function getPartnerAttribution(): PartnerAttrData | null {
  try {
    const raw = localStorage.getItem(PARTNER_ATTR_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PartnerAttrData;
    // Check if still within attribution window
    const trackedAt = new Date(data.tracked_at).getTime();
    const windowMs = data.attribution_window_days * 24 * 60 * 60 * 1000;
    if (Date.now() - trackedAt > windowMs) {
      localStorage.removeItem(PARTNER_ATTR_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Check URL for partner referral params and fire tracking.
 * Call this once on app init (e.g., in App.tsx or a layout effect).
 */
export async function detectAndTrackPartnerReferral(): Promise<void> {
  const url = new URL(window.location.href);
  const refCode = url.searchParams.get("ref");
  const slug = url.searchParams.get("slug");

  if (!refCode && !slug) return;

  // Dedup: don't re-track same ref in same session
  const trackKey = `${refCode || ""}:${slug || ""}:${url.pathname}`;
  const alreadyTracked = sessionStorage.getItem(TRACKED_KEY);
  if (alreadyTracked === trackKey) return;

  const visitorId = getVisitorId();
  const sessionId = crypto.randomUUID();

  try {
    const { data, error } = await supabase.functions.invoke("track-partner-click", {
      body: {
        ref_code: refCode,
        slug,
        landing_path: url.pathname,
        utm_source: url.searchParams.get("utm_source"),
        utm_medium: url.searchParams.get("utm_medium"),
        utm_campaign: url.searchParams.get("utm_campaign"),
        session_id: sessionId,
        visitor_id: visitorId,
      },
    });

    if (!error && data?.ok) {
      // Store attribution for checkout
      const attrData: PartnerAttrData = {
        partner_id: data.partner_id,
        ref_code: data.ref_code,
        tracking_link_id: data.tracking_link_id,
        attribution_window_days: data.attribution_window_days || 30,
        tracked_at: new Date().toISOString(),
      };
      localStorage.setItem(PARTNER_ATTR_KEY, JSON.stringify(attrData));
      sessionStorage.setItem(TRACKED_KEY, trackKey);

      // Clean URL params without reload
      url.searchParams.delete("ref");
      url.searchParams.delete("slug");
      window.history.replaceState({}, "", url.toString());
    }
  } catch (e) {
    console.warn("[Partner Attribution] Tracking failed:", e);
  }
}

/**
 * After user authenticates, link visitor_id to user_id in attributions.
 * Call this after successful login/signup.
 */
export async function linkPartnerAttributionToUser(userId: string): Promise<void> {
  const visitorId = localStorage.getItem(VISITOR_ID_KEY);
  const attr = getPartnerAttribution();
  if (!visitorId || !attr) return;

  try {
    // Use RPC to link visitor attribution to user
    await supabase.rpc("fn_link_visitor_attribution" as any, {
      _visitor_id: visitorId,
      _user_id: userId,
    });
  } catch (e) {
    console.warn("[Partner Attribution] User link failed:", e);
  }
}
