import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { ref_code, slug, landing_path, utm_source, utm_medium, utm_campaign, session_id, visitor_id } = body;

    if (!ref_code && !slug) {
      return new Response(
        JSON.stringify({ error: "ref_code or slug required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve tracking link
    let partnerId: string | null = null;
    let trackingLinkId: string | null = null;
    let resolvedRefCode = ref_code;

    if (slug) {
      const { data: link } = await admin
        .from("partner_tracking_links")
        .select("id, partner_id, slug")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (link) {
        trackingLinkId = link.id;
        partnerId = link.partner_id;
      }
    }

    if (!partnerId && resolvedRefCode) {
      const { data: partner } = await admin
        .from("partner_accounts")
        .select("id, referral_code")
        .eq("referral_code", resolvedRefCode)
        .eq("status", "active")
        .single();

      if (partner) {
        partnerId = partner.id;
        resolvedRefCode = partner.referral_code;
      }
    }

    if (!partnerId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid partner reference" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Hash IP for privacy
    const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
    const ip = forwarded.split(",")[0].trim();
    const ipHash = ip ? await hashString(ip) : null;
    const userAgent = req.headers.get("user-agent")?.substring(0, 512) || null;

    // Store click event
    await admin.from("partner_click_events").insert({
      partner_id: partnerId,
      tracking_link_id: trackingLinkId,
      ref_code: resolvedRefCode,
      landing_path: landing_path || "/",
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      session_id: session_id || null,
      visitor_id: visitor_id || null,
      ip_hash: ipHash,
      user_agent: userAgent,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        partner_id: partnerId,
        ref_code: resolvedRefCode,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[track-partner-click] Error:", e);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 32);
}
