import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Resolve Paywall (anon + auth)
 *
 * Resolves paywall variant for a product/package.
 * - Authenticated users: sticky on user_id, checks entitlements first.
 * - Anonymous visitors: sticky on visitor_id (cookie/local UUID).
 *
 * Inputs (POST JSON):
 *   { product_id?: uuid, package_id?: uuid, experiment_key?: string,
 *     visitor_id?: string, platform?: 'web'|'ios'|'android', trigger_context?: string }
 *
 * If experiment_key is omitted, the function auto-resolves the active
 * experiment for the given package_id (via products.active_package_id).
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

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  const sb = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      product_id,
      package_id,
      experiment_key: bodyExperimentKey,
      visitor_id,
      platform = "web",
      trigger_context,
    } = body as {
      product_id?: string;
      package_id?: string;
      experiment_key?: string | null;
      visitor_id?: string | null;
      platform?: "web" | "ios" | "android";
      trigger_context?: string | null;
    };

    if (!product_id && !package_id) {
      return new Response(
        JSON.stringify({ error: "product_id or package_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optional: resolve user (anon-allowed)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await userClient.auth.getUser(token);
      if (user) userId = user.id;
    }

    // ── 1. Auto-resolve experiment_key from package_id if not given ──
    let experimentKey: string | null = bodyExperimentKey ?? null;
    let resolvedProductId: string | null = product_id ?? null;

    if (!experimentKey && package_id) {
      const { data: expMeta } = await sb.rpc("get_active_paywall_experiment_for_package", {
        p_package_id: package_id,
      });
      if (expMeta && typeof expMeta === "object") {
        experimentKey = (expMeta as Record<string, unknown>).experiment_key as string ?? null;
        if (!resolvedProductId) {
          resolvedProductId = (expMeta as Record<string, unknown>).product_id as string ?? null;
        }
      }
    }

    // ── 2. Auth-Pfad: Check entitlement / org-license ──
    if (userId && resolvedProductId) {
      const { data: hasEntitlement } = await sb.rpc("can_access_product", {
        p_user_id: userId,
        p_product_id: resolvedProductId,
      });
      if (hasEntitlement) {
        return ok({ has_access: true, access_type: "entitlement", platform });
      }
      const { data: hasOrgAccess } = await sb.rpc("check_org_license_access", {
        p_user_id: userId,
        p_product_id: resolvedProductId,
      });
      if (hasOrgAccess) {
        return ok({ has_access: true, access_type: "org_license", platform });
      }
    }

    // ── 3. Variant-Resolution ──
    let variant: Record<string, unknown> | null = null;

    if (experimentKey) {
      if (userId) {
        const { data } = await sb.rpc("assign_paywall_variant", {
          p_user_id: userId,
          p_experiment_key: experimentKey,
          p_platform: platform,
        });
        if (data && !(data as Record<string, unknown>).error) {
          variant = data as Record<string, unknown>;
        }
      } else if (visitor_id) {
        const { data } = await sb.rpc("assign_paywall_variant_anon", {
          p_visitor_id: visitor_id,
          p_experiment_key: experimentKey,
          p_platform: platform,
        });
        if (data && !(data as Record<string, unknown>).error) {
          variant = data as Record<string, unknown>;
        }
      }
    }

    // ── 4. Platform-spezifische Checkout-IDs ──
    let checkout_id: string | null = null;
    let actual_price_cents: number | null = null;
    if (variant) {
      switch (platform) {
        case "ios":
          checkout_id = (variant.apple_sku as string) || null;
          actual_price_cents = (variant.ios_price_cents as number) ?? (variant.price_cents as number);
          break;
        case "android":
          checkout_id = (variant.google_sku as string) || null;
          actual_price_cents = (variant.android_price_cents as number) ?? (variant.price_cents as number);
          break;
        default:
          checkout_id = (variant.stripe_price_id as string) || null;
          actual_price_cents = (variant.web_price_cents as number) ?? (variant.price_cents as number);
      }
    }

    // ── 5. Telemetry: paywall_shown ──
    if (trigger_context && (userId || visitor_id)) {
      await sb.from("conversion_events").insert({
        user_id: userId,
        visitor_id: userId ? null : visitor_id,
        event_type: "paywall_shown",
        metadata: {
          product_id: resolvedProductId,
          package_id,
          experiment_key: experimentKey,
          variant_key: variant?.variant_key ?? null,
          trigger_context,
          platform,
        },
      } as never).then(() => {}, () => {});
    }

    return ok({
      has_access: false,
      experiment_key: experimentKey,
      variant,
      checkout_id,
      actual_price_cents,
      platform,
    });
  } catch (err) {
    console.error("Resolve paywall error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  function ok(payload: Record<string, unknown>) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
