import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEDUP_WINDOW_MINUTES = 30;

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

    // ── Dedup check ──
    // Only count 1 click per partner + visitor + landing_path per 30 min window
    let isDuplicate = false;
    if (visitor_id) {
      const cutoff = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000).toISOString();
      const { data: recent } = await admin
        .from("partner_click_events")
        .select("id")
        .eq("partner_id", partnerId)
        .eq("visitor_id", visitor_id)
        .gte("created_at", cutoff)
        .limit(1);
      
      isDuplicate = (recent?.length ?? 0) > 0;
    }

    // Always store click event (for raw data), but flag duplicates
    const { data: clickRow } = await admin.from("partner_click_events").insert({
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
    }).select("id").single();

    // ── Create or update attribution record ──
    // Upsert: last-touch wins — update existing active attribution or create new
    if (!isDuplicate && visitor_id) {
      try {
        const cookieExpiresAt = new Date(Date.now() + cookieDays * 24 * 60 * 60 * 1000).toISOString();

        // Check for existing active attribution for this visitor (via metadata)
        const { data: existingAttr } = await admin
          .from("partner_attributions")
          .select("id, partner_id")
          .eq("attribution_status", "active")
          .eq("attribution_type", "b2c_referral")
          .filter("metadata_json->>visitor_id", "eq", visitor_id)
          .limit(1);

        if (existingAttr && existingAttr.length > 0) {
          const existing = existingAttr[0];
          if (existing.partner_id === partnerId) {
            // Same partner: update last_touch
            await admin.from("partner_attributions").update({
              last_touch_at: new Date().toISOString(),
              source_tracking_link_id: trackingLinkId,
              source_campaign: utm_campaign || null,
              cookie_expires_at: cookieExpiresAt,
              click_event_id: clickRow?.id || null,
              updated_at: new Date().toISOString(),
            }).eq("id", existing.id);
          } else {
            // Different partner: replace old attribution
            await admin.from("partner_attributions").update({
              attribution_status: "replaced",
              replaced_by_id: null, // will be set after insert
              updated_at: new Date().toISOString(),
            }).eq("id", existing.id);

            const { data: newAttr } = await admin.from("partner_attributions").insert({
              partner_id: partnerId,
              attribution_type: "b2c_referral",
              touch_model: "last_touch",
              first_touch_at: new Date().toISOString(),
              last_touch_at: new Date().toISOString(),
              source_tracking_link_id: trackingLinkId,
              source_campaign: utm_campaign || null,
              cookie_expires_at: cookieExpiresAt,
              click_event_id: clickRow?.id || null,
              metadata_json: { visitor_id, session_id, ref_code: resolvedRefCode },
            }).select("id").single();

            if (newAttr) {
              await admin.from("partner_attributions").update({
                replaced_by_id: newAttr.id,
              }).eq("id", existing.id);
            }
          }
        } else {
          // No existing attribution: create new
          await admin.from("partner_attributions").insert({
            partner_id: partnerId,
            attribution_type: "b2c_referral",
            touch_model: "last_touch",
            first_touch_at: new Date().toISOString(),
            last_touch_at: new Date().toISOString(),
            source_tracking_link_id: trackingLinkId,
            source_campaign: utm_campaign || null,
            cookie_expires_at: cookieExpiresAt,
            click_event_id: clickRow?.id || null,
            metadata_json: { visitor_id, session_id, ref_code: resolvedRefCode },
          });
        }
      } catch (attrErr) {
        console.error("[track-partner-click] Attribution upsert error:", attrErr);
      }
    }

    // ── Get cookie window for attribution hint ──
    const { data: partnerAccount } = await admin
      .from("partner_accounts")
      .select("partner_type")
      .eq("id", partnerId)
      .single();

    let cookieDays = 30;
    if (partnerAccount) {
      const { data: rules } = await admin
        .from("partner_commission_rules")
        .select("cookie_days")
        .eq("partner_type", partnerAccount.partner_type)
        .eq("status", "active")
        .order("priority", { ascending: true })
        .limit(1);
      if (rules?.length) cookieDays = rules[0].cookie_days;
    }

    // Audit log (non-duplicate clicks only)
    if (!isDuplicate) {
      await admin.from("partner_audit_events").insert({
        partner_id: partnerId,
        event_type: "tracking_click",
        entity_type: "partner_click_events",
        metadata_json: {
          ref_code: resolvedRefCode,
          landing_path: landing_path || "/",
          utm_source, utm_medium, utm_campaign,
          tracking_link_id: trackingLinkId,
        },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        partner_id: partnerId,
        tracking_link_id: trackingLinkId,
        ref_code: resolvedRefCode,
        attribution_window_days: cookieDays,
        is_duplicate: isDuplicate,
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
