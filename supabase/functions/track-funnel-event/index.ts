// track-funnel-event: Schreibt anon/auth funnel events in conversion_events.
// Adressiert die Lücke: client-RLS verbietet anon-inserts, was den 80% Drop
// zwischen lead_magnet_view und quiz_started erklärt.
//
// Public function (verify_jwt=false), validiert Eingaben streng, nutzt service_role.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_EVENTS = new Set([
  // legacy
  "paywall_view", "cta_click", "checkout_started", "checkout_completed", "dismissed",
  "pricing_hero_view", "pricing_hero_primary_click", "pricing_hero_secondary_click",
  "shop_view", "product_search", "product_filter", "product_view", "product_select", "checkout_start",
  // SSOT v2 – paketgebunden
  "lead_magnet_view", "quiz_started", "quiz_completed", "lead_capture_submitted", "lead_capture_view",
  // W1 Cut 3b — Adaptive Decision Telemetry (explainable, no free text)
  "adaptive_cta_decision", "recommendation_view", "recommendation_click",
]);

// Pflichtfeld package_id für diese Events (siehe Growth-Memo).
// HINWEIS: lead_magnet_view bewusst NICHT pflichtig — wir wollen den
// unmatched-Drop messen (mapping_source='unmatched' bei SEO-Pages ohne Paket).
const PACKAGE_REQUIRED_EVENTS = new Set([
  "quiz_started", "quiz_completed", "lead_capture_submitted",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function isUuid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const eventType = String(body?.event_type ?? "");
  if (!ALLOWED_EVENTS.has(eventType)) return json({ error: "event_type_not_allowed" }, 400);

  const anonymousId = typeof body?.anonymous_id === "string" ? body.anonymous_id.slice(0, 80) : null;
  const sessionId = typeof body?.session_id === "string" ? body.session_id.slice(0, 80) : null;
  const userId = isUuid(body?.user_id) ? body.user_id : null;
  if (!userId && !anonymousId) return json({ error: "user_or_anon_required" }, 400);

  const packageId = isUuid(body?.package_id) ? body.package_id : null;
  if (PACKAGE_REQUIRED_EVENTS.has(eventType) && !packageId) {
    return json({ error: "package_id_required_for_event", event_type: eventType }, 400);
  }

  const curriculumId = isUuid(body?.curriculum_id) ? body.curriculum_id : null;
  const pagePath = typeof body?.page_path === "string" ? body.page_path.slice(0, 500) : null;
  const persona = typeof body?.persona === "string" ? body.persona.slice(0, 50) : null;
  const sourcePage = typeof body?.source_page === "string" ? body.source_page.slice(0, 200) : null;
  const meta = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // First-class columns confirmed in conversion_events:
  // user_id, anonymous_id, session_id, curriculum_id, event_type, page_path, metadata.
  // package_id bleibt (noch) in metadata, da keine Spalte existiert.
  const payload: Record<string, unknown> = {
    user_id: userId,
    anonymous_id: userId ? null : anonymousId,
    session_id: sessionId,
    event_type: eventType,
    curriculum_id: curriculumId,
    page_path: pagePath,
    metadata: {
      ...meta,
      package_id: packageId,
      persona,
      source_page: sourcePage,
      ts_server: new Date().toISOString(),
    },
  };

  const { error } = await sb.from("conversion_events").insert(payload as any);
  if (error) {
    console.error("track-funnel-event insert failed", {
      event_type: eventType,
      package_id: packageId,
      error: error.message,
    });
    return json({ error: "insert_failed", detail: error.message }, 500);
  }
  return json({ ok: true });
});
