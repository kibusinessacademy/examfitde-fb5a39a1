import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Resolve Paywall
 *
 * Returns the correct paywall configuration for a user based on:
 * 1. Whether they already have access (entitlement or org license)
 * 2. Which experiment variant they're assigned to
 * 3. Which platform they're on (web/ios/android)
 *
 * Response:
 * - has_access: true → no paywall needed
 * - has_access: false → paywall variant returned with platform-specific checkout ID
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // User client for auth
  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  // Service client for RPCs
  const sb = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { product_id, experiment_key, platform = "web", trigger_context } = body;

    if (!product_id) {
      return new Response(
        JSON.stringify({ error: "product_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 1. Check existing access ─────────────────────────────
    // Personal entitlement
    const { data: hasEntitlement } = await sb.rpc("can_access_product", {
      p_user_id: user.id,
      p_product_id: product_id,
    });

    if (hasEntitlement) {
      return new Response(
        JSON.stringify({ has_access: true, access_type: "entitlement" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Org license
    const { data: hasOrgAccess } = await sb.rpc("check_org_license_access", {
      p_user_id: user.id,
      p_product_id: product_id,
    });

    if (hasOrgAccess) {
      return new Response(
        JSON.stringify({ has_access: true, access_type: "org_license" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. No access → resolve paywall variant ───────────────
    let variant = null;

    if (experiment_key) {
      const { data: variantData } = await sb.rpc("assign_paywall_variant", {
        p_user_id: user.id,
        p_experiment_key: experiment_key,
        p_platform: platform,
      });

      if (variantData && !(variantData as any).error) {
        variant = variantData;
      }
    }

    // Determine checkout ID based on platform
    let checkout_id: string | null = null;
    if (variant) {
      const v = variant as Record<string, unknown>;
      switch (platform) {
        case "ios": checkout_id = v.apple_sku as string || null; break;
        case "android": checkout_id = v.google_sku as string || null; break;
        default: checkout_id = v.stripe_price_id as string || null;
      }
    }

    // ── 3. Log conversion event ──────────────────────────────
    if (trigger_context) {
      await sb.from("conversion_events").insert({
        user_id: user.id,
        event_type: "paywall_shown",
        metadata: {
          product_id,
          experiment_key,
          variant_key: (variant as any)?.variant_key,
          trigger_context,
          platform,
        },
      }).then(() => {});
    }

    return new Response(
      JSON.stringify({
        has_access: false,
        variant,
        checkout_id,
        platform,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Resolve paywall error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
