// Unified IAP receipt validator (Apple App Store + Google Play).
// Dispatches per platform to existing verify-ios-receipt / verify-android-purchase,
// returns a normalized result and unlocks the course player via store entitlements.
//
// Body:
//   {
//     platform: "ios" | "android",
//     sku: string,
//     curriculum_id: string,
//     // iOS:
//     transaction_id?: string,
//     receipt_data?: string,
//     // Android:
//     purchase_token?: string,
//     order_id?: string,
//     package_name?: string,
//   }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const log = (step: string, details?: Record<string, unknown>) =>
  console.log(`[VALIDATE-IAP-RECEIPT] ${step}`, details ? JSON.stringify(details) : "");

type Platform = "ios" | "android";

interface NormalizedResult {
  success: boolean;
  duplicate?: boolean;
  receipt_id?: string;
  entitlement_id?: string;
  expires_at?: string;
  platform: Platform;
  error?: string;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;

  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "missing_auth" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userResp, error: uErr } = await anon.auth.getUser(token);
    if (uErr || !userResp?.user) {
      return new Response(JSON.stringify({ success: false, error: "unauthenticated" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }
    const user = userResp.user;

    const body = await req.json().catch(() => ({}));
    const platform = body.platform as Platform | undefined;
    const sku = body.sku as string | undefined;
    const curriculum_id = body.curriculum_id as string | undefined;

    if (!platform || !["ios", "android"].includes(platform) || !sku || !curriculum_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "invalid_body",
          required: ["platform", "sku", "curriculum_id"],
        }),
        { status: 400, headers: jsonHeaders },
      );
    }

    log("dispatch", { platform, sku, curriculum_id, user_id: user.id });

    // Dispatch to platform-specific verifier (each handles its own store API call,
    // duplicate detection, store_receipts insert and create_store_entitlement RPC).
    const targetFn = platform === "ios" ? "verify-ios-receipt" : "verify-android-purchase";
    const downstreamBody = platform === "ios"
      ? {
          transaction_id: body.transaction_id,
          receipt_data: body.receipt_data,
          sku,
          curriculum_id,
        }
      : {
          purchase_token: body.purchase_token ?? body.purchaseToken,
          sku,
          curriculum_id,
          order_id: body.order_id ?? body.orderId,
          package_name: body.package_name ?? body.packageName,
        };

    const downstream = await fetch(`${SUPABASE_URL}/functions/v1/${targetFn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader, // forward user JWT
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(downstreamBody),
    });

    const text = await downstream.text();
    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!downstream.ok || parsed?.success === false || parsed?.error) {
      log("downstream_error", { status: downstream.status, parsed });
      const result: NormalizedResult = {
        success: false,
        platform,
        error: parsed?.error ?? `downstream_${downstream.status}`,
      };
      // Best-effort audit
      try {
        const admin = createClient(SUPABASE_URL, SERVICE_KEY);
        await admin.from("audit_log").insert({
          action: "iap_validate_failed",
          actor_id: user.id,
          metadata: { platform, sku, curriculum_id, error: result.error },
        });
      } catch (_) { /* audit_log may not exist; ignore */ }
      return new Response(JSON.stringify(result), {
        status: downstream.status >= 400 ? downstream.status : 422,
        headers: jsonHeaders,
      });
    }

    const result: NormalizedResult = {
      success: true,
      duplicate: Boolean(parsed.duplicate),
      receipt_id: parsed.receipt_id,
      entitlement_id: parsed.entitlement_id,
      expires_at: parsed.expires_at,
      platform,
    };

    log("ok", result as Record<string, unknown>);
    return new Response(JSON.stringify(result), { status: 200, headers: jsonHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
